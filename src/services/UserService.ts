import prisma from '../utils/prisma';
import { UserResponse, UpdateUserRequest } from '../models';
import { Errors } from '../middleware/errorHandler';
import { getKstMidnightUtc } from '../utils/kst';
import { resolveLocaleFromHeader } from '../utils/i18n/push';

const MAX_AD_HEARTS = 5; // 1회 광고 시청 보상 최대 하트 수

export class UserService {
  /**
   * userId로 사용자 조회 (현재 활성 가족의 그룹별 nickname, hearts, role 반환)
   *
   * options.grantDailyHeart=true 인 호출은 그룹별 데일리 하트(+1) 지급을
   * 동기적으로 시도하고, 결과를 응답의 heartGrantedToday / hearts 에 반영한다.
   * iOS 의 명시적 opt-in 경로(refreshHomeData / onAppear)에서만 켜고, 부수
   * 호출(QuestionDetail/ProfileEdit hearts sync 등)은 default false 로 호출해
   * "오늘 첫 호출이 부수 경로에서 발생해 grant 만 되고 팝업은 누락" 되는
   * 시나리오를 막는다.
   */
  async getUserByUserId(
    userId: string,
    options?: { grantDailyHeart?: boolean }
  ): Promise<UserResponse> {
    const user = await prisma.user.findUnique({ where: { userId } });
    if (!user) throw Errors.notFound('사용자');

    let heartGrantedToday = false;
    if (options?.grantDailyHeart && user.familyId) {
      const result = await this.grantDailyHeartIfNeeded(user.id, user.familyId);
      heartGrantedToday = result.granted;
    }

    if (user.familyId) {
      const membership = await prisma.familyMembership.findUnique({
        where: { userId_familyId: { userId: user.id, familyId: user.familyId } },
      });
      if (membership) {
        return {
          id: user.id,
          email: user.email,
          name: membership.nickname ?? user.name,
          profileImageUrl: user.profileImageUrl,
          role: membership.role as UserResponse['role'],
          familyId: user.familyId,
          hearts: membership.hearts,
          moodId: membership.colorId ?? user.moodId ?? null,
          createdAt: user.createdAt,
          heartGrantedToday,
        };
      }
    }

    return { ...this.toUserResponse(user), heartGrantedToday };
  }

  /**
   * 접속 로그 + locale 동기화. heart 지급은 분리됨(grantDailyHeartIfNeeded).
   *
   * 이전 recordAccess 가 한 번에 묶고 있던 access log + locale + heart 지급
   * 셋 중 heart 지급만 떼어 /users/me?grantDailyHeart=true 동기 경로로 이전
   * (MG-80). 응답 본문에 heartGrantedToday 플래그를 실어 iOS 가 거짓 팝업
   * 가능성 없이 정합 트리거하도록 만들기 위함.
   */
  async logAccess(userId: string, acceptLanguage?: string | null): Promise<void> {
    const user = await prisma.user.findUnique({ where: { userId } });
    if (!user) return;

    prisma.userAccessLog
      .create({ data: { userId: user.id } })
      .catch((err) => {
        console.warn('[logAccess] access log 실패', { userId, err: (err as Error)?.message });
      });

    const resolvedLocale = acceptLanguage ? resolveLocaleFromHeader(acceptLanguage) : null;
    if (resolvedLocale && user.locale !== resolvedLocale) {
      await prisma.user
        .update({ where: { id: user.id }, data: { locale: resolvedLocale } })
        .catch((err) => {
          console.warn('[logAccess] locale 동기화 실패', { userId, err: (err as Error)?.message });
        });
    }
  }

  /**
   * 활성 그룹 데일리 하트 +1 (atomic test-and-set on FamilyMembership).
   *
   * race 차단 패턴은 MG-76 과 동일: SELECT 없이 updateMany WHERE 에 시간
   * 조건을 박아 가장 먼저 커밋한 트랜잭션만 count=1 을 받게 한다. 이전
   * 글로벌 User.lastHeartGrantedAt 기준이었을 땐 같은 KST 날짜에 그룹
   * A→B 전환 시 새 그룹이 +0 으로 누락되는 결함이 있었음 (MG-80 design flaw).
   * 이제 (userId, familyId) 키로 처리하므로 그룹별 매일 1개가 자연스럽게 보장.
   *
   * hearts increment 도 같은 updateMany 안에 포함해 grant 와 +1 이 한
   * 트랜잭션·한 row 단위로 묶이게 한다 (분리하면 락 해제 사이 인터리빙 가능).
   *
   * cutoff 는 반드시 `getKstMidnightUtc()` 사용. lastHeartGrantedAt 은
   * 시각 포함 DateTime 이라 `getKstToday()` 의 "KST 날짜를 UTC 자정 시각으로
   * 표기" 패턴과 9시간 어긋나, KST 0~9시 윈도우에서 매 호출마다 grant 가
   * 발생하던 결함이 있었음 (MG-81).
   */
  async grantDailyHeartIfNeeded(
    userPk: string,
    familyId: string
  ): Promise<{ granted: boolean }> {
    const cutoff = getKstMidnightUtc();
    const result = await prisma.familyMembership.updateMany({
      where: {
        userId: userPk,
        familyId,
        OR: [
          { lastHeartGrantedAt: null },
          { lastHeartGrantedAt: { lt: cutoff } },
        ],
      },
      data: {
        lastHeartGrantedAt: new Date(),
        hearts: { increment: 1 },
      },
    });
    return { granted: result.count > 0 };
  }

  /**
   * 사용자 정보 수정
   * - name, role → 현재 활성 가족 FamilyMembership 업데이트 (그룹별)
   * - moodId, profileImageUrl → 글로벌 User 업데이트
   */
  async updateUser(userId: string, data: UpdateUserRequest): Promise<UserResponse> {
    const user = await prisma.user.findUnique({ where: { userId } });
    if (!user) throw Errors.notFound('사용자');

    // 글로벌 업데이트: moodId, profileImageUrl
    const globalUpdates: { profileImageUrl?: string; moodId?: string } = {};
    if (data.profileImageUrl !== undefined) globalUpdates.profileImageUrl = data.profileImageUrl;
    if (data.moodId !== undefined) globalUpdates.moodId = data.moodId;

    if (Object.keys(globalUpdates).length > 0) {
      await prisma.user.update({ where: { userId }, data: globalUpdates });
    }

    // 그룹별 업데이트: name → nickname, role, moodId → colorId
    if (user.familyId && (data.name || data.role || data.moodId !== undefined)) {
      const membershipUpdate: Record<string, unknown> = {};

      if (data.name) {
        // 7일 닉네임 변경 제한 확인
        const membership = await prisma.familyMembership.findUnique({
          where: { userId_familyId: { userId: user.id, familyId: user.familyId } },
          select: { nicknameChangedAt: true },
        });
        if (membership?.nicknameChangedAt) {
          const daysSince =
            (Date.now() - membership.nicknameChangedAt.getTime()) / (1000 * 60 * 60 * 24);
          if (daysSince < 7) {
            const daysLeft = Math.ceil(7 - daysSince);
            throw Errors.badRequest(
              `닉네임은 7일에 한 번만 변경할 수 있어요. ${daysLeft}일 후에 변경 가능해요.`
            );
          }
        }
        membershipUpdate.nickname = data.name;
        membershipUpdate.nicknameChangedAt = new Date();
      }

      if (data.role) membershipUpdate.role = data.role;
      if (data.moodId !== undefined) membershipUpdate.colorId = data.moodId;

      if (Object.keys(membershipUpdate).length > 0) {
        await prisma.familyMembership.updateMany({
          where: { userId: user.id, familyId: user.familyId },
          data: membershipUpdate,
        });
      }
    } else if (data.name) {
      // 소속 가족 없으면 글로벌 이름 업데이트
      await prisma.user.update({ where: { userId }, data: { name: data.name } });
    }

    return this.getUserByUserId(userId);
  }

  /**
   * 연속 답변 스트릭 계산
   * 오늘(또는 어제)부터 소급하여 연속으로 답변한 날 수를 반환
   */
  async getStreak(userId: string): Promise<number> {
    const user = await prisma.user.findUnique({ where: { userId }, select: { id: true } });
    if (!user) return 0;

    // 답변 날짜 목록 (UTC date, 중복 제거)
    const answers = await prisma.answer.findMany({
      where: { userId: user.id },
      select: { createdAt: true },
      orderBy: { createdAt: 'desc' },
    });

    if (answers.length === 0) return 0;

    // 날짜 집합 생성 (YYYY-MM-DD 문자열)
    const dateSet = new Set(
      answers.map(a => {
        const d = a.createdAt;
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      })
    );

    const today = new Date();
    const todayStr = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-${String(today.getUTCDate()).padStart(2, '0')}`;
    const yesterdayDate = new Date(today);
    yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
    const yesterdayStr = `${yesterdayDate.getUTCFullYear()}-${String(yesterdayDate.getUTCMonth() + 1).padStart(2, '0')}-${String(yesterdayDate.getUTCDate()).padStart(2, '0')}`;

    // 오늘 또는 어제 답변이 없으면 스트릭 0
    const startStr = dateSet.has(todayStr) ? todayStr : (dateSet.has(yesterdayStr) ? yesterdayStr : null);
    if (!startStr) return 0;

    // startStr부터 과거로 연속 날 수 계산
    let streak = 0;
    let cursor = new Date(startStr + 'T00:00:00Z');
    while (true) {
      const str = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}-${String(cursor.getUTCDate()).padStart(2, '0')}`;
      if (!dateSet.has(str)) break;
      streak++;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }

    return streak;
  }

  /**
   * 광고 시청 보상 하트 지급
   */
  async grantAdHearts(userId: string, amount: number): Promise<number> {
    if (!Number.isInteger(amount) || amount < 1 || amount > MAX_AD_HEARTS) {
      throw Errors.badRequest(`하트 지급 수량은 1~${MAX_AD_HEARTS} 사이여야 합니다.`);
    }

    const user = await prisma.user.findUnique({ where: { userId } });
    if (!user) throw Errors.notFound('사용자');
    if (!user.familyId) throw Errors.badRequest('활성 그룹이 없습니다.');

    const updated = await prisma.familyMembership.update({
      where: { userId_familyId: { userId: user.id, familyId: user.familyId } },
      data: { hearts: { increment: amount } },
    });

    return updated.hearts;
  }

  /**
   * APNs 디바이스 토큰 저장/갱신
   * 동일 토큰을 보유한 다른 유저가 있으면 해당 유저의 토큰을 null 처리 (중복 푸시 방지)
   */
  async registerDeviceToken(userId: string, token: string, environment?: 'sandbox' | 'production'): Promise<void> {
    if (!token) throw Errors.badRequest('디바이스 토큰이 비어 있습니다.');
    const user = await prisma.user.findUnique({ where: { userId } });
    if (!user) throw Errors.notFound('사용자');

    // 동일 APNs 토큰을 가진 다른 유저의 토큰 제거 (디바이스 1대 = 토큰 1개 원칙)
    await prisma.user.updateMany({
      where: { apnsToken: token, id: { not: user.id } },
      data: { apnsToken: null, apnsEnvironment: null },
    });

    // environment 미지정 시(구형 클라이언트) production 가정 — v1 배포 유저의 하위호환 경로.
    await prisma.user.update({
      where: { id: user.id },
      data: { apnsToken: token, apnsEnvironment: environment ?? 'production' },
    });
  }

  /**
   * FCM 디바이스 토큰 저장/갱신 (Android)
   * 동일 토큰을 보유한 다른 유저가 있으면 해당 유저의 토큰을 null 처리 (중복 푸시 방지)
   */
  async registerFcmToken(userId: string, token: string): Promise<void> {
    if (!token) throw Errors.badRequest('디바이스 토큰이 비어 있습니다.');
    const user = await prisma.user.findUnique({ where: { userId } });
    if (!user) throw Errors.notFound('사용자');

    // 동일 FCM 토큰을 가진 다른 유저의 토큰 제거
    await prisma.user.updateMany({
      where: { fcmToken: token, id: { not: user.id } },
      data: { fcmToken: null },
    });

    await prisma.user.update({ where: { id: user.id }, data: { fcmToken: token } });
  }

  /**
   * 알림 선호도 조회
   */
  async getNotificationPreferences(userId: string) {
    const user = await prisma.user.findUnique({ where: { userId } });
    if (!user) throw Errors.notFound('사용자');
    return {
      notifAnswer: user.notifAnswer,
      notifNudge: user.notifNudge,
      notifQuestion: user.notifQuestion,
      notifAnswererNudge: user.notifAnswererNudge,
      quietHoursEnabled: user.quietHoursEnabled,
      quietHoursStart: user.quietHoursStart,
      quietHoursEnd: user.quietHoursEnd,
    };
  }

  /**
   * 알림 선호도 수정
   */
  async updateNotificationPreferences(
    userId: string,
    data: {
      notifAnswer?: boolean;
      notifNudge?: boolean;
      notifQuestion?: boolean;
      notifAnswererNudge?: boolean;
      quietHoursEnabled?: boolean;
      quietHoursStart?: string;
      quietHoursEnd?: string;
    }
  ) {
    const user = await prisma.user.findUnique({ where: { userId } });
    if (!user) throw Errors.notFound('사용자');
    const updated = await prisma.user.update({ where: { id: user.id }, data });
    return {
      notifAnswer: updated.notifAnswer,
      notifNudge: updated.notifNudge,
      notifQuestion: updated.notifQuestion,
      notifAnswererNudge: updated.notifAnswererNudge,
      quietHoursEnabled: updated.quietHoursEnabled,
      quietHoursStart: updated.quietHoursStart,
      quietHoursEnd: updated.quietHoursEnd,
    };
  }

  /**
   * DB ID로 사용자 조회 — 본인 또는 같은 가족 구성원만 조회 가능 (IDOR 방지)
   */
  async getUserById(requestingUserId: string, targetId: string): Promise<UserResponse> {
    const target = await prisma.user.findUnique({ where: { id: targetId } });
    if (!target) throw Errors.notFound('사용자');

    // 본인 조회는 항상 허용
    if (target.userId === requestingUserId) {
      return this.toUserResponse(target);
    }

    // 그 외는 같은 가족 구성원이어야 함
    const requester = await prisma.user.findUnique({ where: { userId: requestingUserId } });
    if (!requester) throw Errors.unauthorized('인증된 사용자를 찾을 수 없습니다.');

    if (!requester.familyId || requester.familyId !== target.familyId) {
      throw Errors.forbidden('해당 사용자 정보에 접근할 권한이 없습니다.');
    }

    return this.toUserResponse(target);
  }

  /**
   * DB 모델을 응답 DTO로 변환
   */
  private toUserResponse(user: {
    id: string;
    email: string;
    name: string;
    profileImageUrl: string | null;
    role: string;
    familyId: string | null;
    hearts: number;
    moodId?: string | null;
    createdAt: Date;
  }): UserResponse {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      profileImageUrl: user.profileImageUrl,
      role: user.role as UserResponse['role'],
      familyId: user.familyId,
      hearts: user.hearts,
      moodId: user.moodId ?? null,
      createdAt: user.createdAt,
      heartGrantedToday: false,
    };
  }
}
