import prisma from '../utils/prisma';
import { UserResponse, UpdateUserRequest } from '../models';
import { Errors } from '../middleware/errorHandler';

const MAX_AD_HEARTS = 5; // 1회 광고 시청 보상 최대 하트 수

export class UserService {
  /**
   * userId로 사용자 조회 (현재 활성 가족의 그룹별 nickname, hearts, role 반환)
   */
  async getUserByUserId(userId: string): Promise<UserResponse> {
    const user = await prisma.user.findUnique({ where: { userId } });
    if (!user) throw Errors.notFound('사용자');

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
        };
      }
    }

    return this.toUserResponse(user);
  }

  /**
   * 접속 기록 저장 + 하루 첫 접속 시 활성 가족 그룹 하트 +1
   */
  async recordAccess(userId: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { userId } });
    if (!user) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const alreadyGrantedToday =
      user.lastHeartGrantedAt && user.lastHeartGrantedAt >= today;

    const tasks: Promise<unknown>[] = [
      prisma.userAccessLog.create({ data: { userId: user.id } }),
    ];

    if (!alreadyGrantedToday) {
      tasks.push(
        prisma.user.update({
          where: { id: user.id },
          data: { lastHeartGrantedAt: new Date() },
        })
      );
      if (user.familyId) {
        tasks.push(
          prisma.familyMembership.updateMany({
            where: { userId: user.id, familyId: user.familyId },
            data: { hearts: { increment: 1 } },
          })
        );
      }
    }

    await Promise.all(tasks);
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
    if (!user.familyId) throw Errors.badRequest('활성 가족이 없습니다.');

    const updated = await prisma.familyMembership.update({
      where: { userId_familyId: { userId: user.id, familyId: user.familyId } },
      data: { hearts: { increment: amount } },
    });

    return updated.hearts;
  }

  /**
   * APNs 디바이스 토큰 저장/갱신
   */
  async registerDeviceToken(userId: string, token: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { userId } });
    if (!user) throw Errors.notFound('사용자');
    await prisma.user.update({ where: { id: user.id }, data: { apnsToken: token } });
  }

  /**
   * FCM 디바이스 토큰 저장/갱신 (Android)
   */
  async registerFcmToken(userId: string, token: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { userId } });
    if (!user) throw Errors.notFound('사용자');
    await prisma.user.update({ where: { id: user.id }, data: { fcmToken: token } });
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
    };
  }
}
