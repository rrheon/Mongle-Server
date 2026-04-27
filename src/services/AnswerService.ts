import prisma from '../utils/prisma';
import {
  CreateAnswerRequest,
  UpdateAnswerRequest,
  AnswerResponse,
  FamilyAnswersResponse,
  UserResponse,
} from '../models';
import { Errors } from '../middleware/errorHandler';
import { NotificationService } from './NotificationService';
import { PushNotificationService } from './PushNotificationService';
import { tryFinalizeDailyQuestion } from './dailyQuestionCompletion';
import { getPushMessages } from '../utils/i18n/push';
import { isInQuietHours } from '../utils/quietHours';

const notificationService = new NotificationService();
const pushService = new PushNotificationService();

export class AnswerService {

  /**
   * 답변 작성
   */
  async createAnswer(userId: string, data: CreateAnswerRequest): Promise<AnswerResponse> {
    const user = await prisma.user.findUnique({
      where: { userId },
    });

    if (!user) {
      throw Errors.notFound('사용자');
    }

    // 질문 존재 확인 — iOS는 UUID를 대문자로 전송하므로 소문자로 정규화
    const normalizedQuestionId = data.questionId.toLowerCase();
    const question = await prisma.question.findUnique({
      where: { id: normalizedQuestionId },
    });

    if (!question) {
      throw Errors.notFound('질문');
    }

    // 해당 질문이 사용자의 가족에 배정된 질문인지 검증
    let activeDailyQuestion: { id: string } | null = null;
    if (user.familyId) {
      const dailyQuestion = await prisma.dailyQuestion.findFirst({
        where: { questionId: normalizedQuestionId, familyId: user.familyId },
      });
      if (!dailyQuestion) {
        throw Errors.badRequest('이 질문은 그룹에 배정되지 않았습니다.');
      }
      activeDailyQuestion = dailyQuestion;
    }

    // 이미 답변했는지 확인
    const existingAnswer = await prisma.answer.findUnique({
      where: {
        userId_questionId: {
          userId: user.id,
          questionId: normalizedQuestionId,
        },
      },
    });

    if (existingAnswer) {
      throw Errors.conflict('이미 이 질문에 답변했습니다.');
    }

    // 답변 생성
    const answer = await prisma.answer.create({
      data: {
        content: data.content,
        imageUrl: data.imageUrl,
        moodId: data.moodId,
        userId: user.id,
        questionId: normalizedQuestionId,
      },
      include: { user: true },
    });

    // 하트 +1, 답변 시 선택한 캐릭터 색상(moodId) 저장 (FamilyMembership 기준)
    if (user.familyId) {
      await prisma.familyMembership.updateMany({
        where: { userId: user.id, familyId: user.familyId },
        data: {
          hearts: { increment: 1 },
          ...(data.moodId && { colorId: data.moodId }),
        },
      });

      // 가족 멤버(본인 제외)에게 답변 알림 발송
      const senderMembership = await prisma.familyMembership.findUnique({
        where: { userId_familyId: { userId: user.id, familyId: user.familyId } },
        select: { nickname: true, colorId: true },
      });
      const senderNickname = senderMembership?.nickname ?? user.name;
      const senderColorId = senderMembership?.colorId ?? data.moodId ?? 'loved';

      // FamilyMembership 기반 조회 — User.familyId 는 "현재 활성 가족" 1개만 가리키므로,
      // 멤버가 다른 그룹을 활성으로 두면 매칭 0건이 되어 MEMBER_ANSWERED 알림이 누락되던
      // 버그(MG-29) 수정. 본인 제외는 userId 비교로 처리.
      const otherMemberships = await prisma.familyMembership.findMany({
        where: { familyId: user.familyId, userId: { not: user.id } },
        select: {
          user: {
            select: {
              id: true, apnsToken: true, apnsEnvironment: true, fcmToken: true,
              locale: true, notifAnswer: true,
              quietHoursEnabled: true, quietHoursStart: true, quietHoursEnd: true,
            },
          },
        },
      });
      const otherMembers = otherMemberships.map((m) => m.user);

      // Lambda에서는 fire-and-forget 패턴이 안 됨 — 핸들러가 응답하면 runtime이 frozen 처리되어
      // 백그라운드 HTTP/2 APNs 연결이 중단됨. 모든 푸시 작업을 await 처리.

      // 1단계: DB 알림 저장 (뱃지 카운트 조회 전에 완료해야 정확한 수치 반영)
      const dbNotifTasks: Promise<unknown>[] = [];
      for (const member of otherMembers) {
        const msgs = getPushMessages(member.locale);
        const title = msgs.memberAnswered.title(senderNickname);
        const body = msgs.memberAnswered.body;
        dbNotifTasks.push(
          notificationService.createNotification(member.id, 'MEMBER_ANSWERED', title, body, user.familyId, senderColorId).catch((e) => {
            console.warn('[Answer] 알림 저장 실패:', e);
          })
        );
      }
      await Promise.all(dbNotifTasks);

      // 2단계: 푸시 발송 (DB 알림 반영된 뱃지 카운트 사용)
      const pushTasks: Promise<unknown>[] = [];
      for (const member of otherMembers) {
        if (!member.notifAnswer) continue;
        // quiet hours 면 푸시만 건너뜀. DB 알림은 1단계에서 이미 저장됨.
        if (isInQuietHours(member)) continue;
        const msgs = getPushMessages(member.locale);
        const title = msgs.memberAnswered.title(senderNickname);
        const body = msgs.memberAnswered.body;

        if (member.apnsToken) {
          pushTasks.push(
            (async () => {
              const badgeCount = await notificationService.getUnreadCount(member.id);
              await pushService.sendApnsPush(member.apnsToken!, title, body, 'MEMBER_ANSWERED', badgeCount, member.apnsEnvironment);
            })().catch((e) => {
              console.warn('[Answer] APNs 푸시 실패:', e);
            })
          );
        }
        if (member.fcmToken) {
          pushTasks.push(
            pushService.sendFcmPush(member.fcmToken, title, body, 'MEMBER_ANSWERED', senderColorId).catch((e) => {
              console.warn('[Answer] FCM 푸시 실패:', e);
            })
          );
        }
      }
      await Promise.all(pushTasks);

      // 그룹 전원이 이번 답변으로 완료되었다면 DailyQuestion.completedAt 을 기록
      // → history 상 "완료일자" 기준으로 노출 (20일 배정 + 21일 완료 → 21일에 기록)
      if (activeDailyQuestion) {
        try {
          await tryFinalizeDailyQuestion({
            familyId: user.familyId,
            dailyQuestionId: activeDailyQuestion.id,
          });
        } catch (e) {
          console.warn('[Answer] DQ finalize 실패:', e);
        }
      }
    }

    return this.toAnswerResponse(answer);
  }

  /**
   * 내 답변 조회
   */
  async getMyAnswer(userId: string, questionId: string): Promise<AnswerResponse | null> {
    const user = await prisma.user.findUnique({
      where: { userId },
    });

    if (!user) {
      throw Errors.notFound('사용자');
    }

    const answer = await prisma.answer.findUnique({
      where: {
        userId_questionId: {
          userId: user.id,
          questionId: questionId.toLowerCase(),
        },
      },
      include: { user: true },
    });

    if (!answer) {
      return null;
    }

    return this.toAnswerResponse(answer);
  }

  /**
   * 가족 답변 목록 조회
   */
  async getFamilyAnswers(userId: string, questionId: string): Promise<FamilyAnswersResponse> {
    const user = await prisma.user.findUnique({
      where: { userId },
    });

    if (!user) {
      throw Errors.notFound('사용자');
    }

    if (!user.familyId) {
      return {
        answers: [],
        totalCount: 0,
        myAnswer: null,
        memberStatuses: [],
      };
    }

    // 가족 멤버 닉네임, 색상, skippedDate 조회
    const memberships = await prisma.familyMembership.findMany({
      where: { familyId: user.familyId },
      select: { userId: true, nickname: true, colorId: true, skippedDate: true, user: { select: { name: true, moodId: true } } },
    });
    const nicknameMap = new Map(
      memberships.map((m) => [m.userId, m.nickname ?? m.user.name])
    );
    const colorMap = new Map(
      memberships.map((m) => [m.userId, m.colorId ?? m.user.moodId ?? 'loved'])
    );
    // FamilyMembership 기반 멤버 ID 집합. user.familyId 단일 활성 그룹 필드는
    // 다대다 전환 이후 답변 조회 기준으로 부정확 (그룹 이동/중복 가입 시 누락).
    // MG-29 (멤버 조회) 와 동일 패턴을 답변 조회에도 적용.
    const memberUserIds = memberships.map((m) => m.userId);

    // 해당 질문의 DailyQuestion 조회 (skip 날짜 비교용)
    const dailyQuestion = await prisma.dailyQuestion.findFirst({
      where: {
        question: { id: questionId.toLowerCase() },
        familyId: user.familyId,
      },
      orderBy: { date: 'desc' },
    });

    // 가족 구성원들의 답변 조회
    const answers = await prisma.answer.findMany({
      where: {
        questionId: questionId.toLowerCase(),
        userId: { in: memberUserIds },
      },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });

    const myAnswer = answers.find((a) => a.userId === user.id);
    const answeredUserIds = new Set(answers.map((a) => a.userId));

    // 각 멤버의 답변/스킵/미답변 상태 구성
    const memberStatuses = memberships.map((m) => {
      if (answeredUserIds.has(m.userId)) {
        return {
          userId: m.userId,
          userName: m.nickname ?? m.user.name,
          colorId: m.colorId ?? m.user.moodId ?? 'loved',
          status: 'answered' as const,
        };
      }
      const skipped =
        dailyQuestion != null &&
        m.skippedDate != null &&
        m.skippedDate.toISOString().split('T')[0] === dailyQuestion.date.toISOString().split('T')[0];
      return {
        userId: m.userId,
        userName: m.nickname ?? m.user.name,
        colorId: m.colorId ?? m.user.moodId ?? 'loved',
        status: skipped ? ('skipped' as const) : ('not_answered' as const),
      };
    });

    return {
      answers: answers.map((a) => this.toAnswerResponse(a, nicknameMap, colorMap)),
      totalCount: answers.length,
      myAnswer: myAnswer ? this.toAnswerResponse(myAnswer, nicknameMap, colorMap) : null,
      memberStatuses,
    };
  }

  /**
   * 답변 수정
   */
  async updateAnswer(
    userId: string,
    answerId: string,
    data: UpdateAnswerRequest
  ): Promise<AnswerResponse> {
    const user = await prisma.user.findUnique({
      where: { userId },
    });

    if (!user) {
      throw Errors.notFound('사용자');
    }

    const normalizedAnswerId = answerId.toLowerCase();
    const answer = await prisma.answer.findUnique({
      where: { id: normalizedAnswerId },
    });

    if (!answer) {
      throw Errors.notFound('답변');
    }

    if (answer.userId !== user.id) {
      throw Errors.forbidden('본인의 답변만 수정할 수 있습니다.');
    }

    // 하트 잔액 사전 검사 — decrement 무조건 실행 시 음수 가능. 정책상 0 이하는 차단.
    // 가족 소속 X 인 경우 하트 정책 자체를 적용 안 함.
    if (user.familyId) {
      const membership = await prisma.familyMembership.findUnique({
        where: { userId_familyId: { userId: user.id, familyId: user.familyId } },
        select: { hearts: true },
      });
      if (!membership || membership.hearts < 1) {
        throw Errors.badRequest('하트가 부족합니다. 답변 수정에는 하트 1개가 필요합니다.');
      }
    }

    // 답변 수정 + 하트 차감 + colorId 업데이트를 원자적으로 처리.
    // hearts >= 1 조건을 updateMany where 에 명시해 위 사전 검사와 트랜잭션 사이의
    // race (동시 다른 클라가 차감) 도 차단. count 0 이면 부족 에러로 환원.
    const updateOps: any[] = [
      prisma.answer.update({
        where: { id: normalizedAnswerId },
        data: {
          ...(data.content !== undefined && { content: data.content }),
          ...(data.imageUrl !== undefined && { imageUrl: data.imageUrl }),
          ...(data.moodId !== undefined && { moodId: data.moodId }),
        },
        include: { user: true },
      }),
    ];

    if (user.familyId) {
      updateOps.push(
        prisma.familyMembership.updateMany({
          where: {
            userId: user.id,
            familyId: user.familyId,
            hearts: { gte: 1 },
          },
          data: {
            hearts: { decrement: 1 },
            ...(data.moodId && { colorId: data.moodId }),
          },
        })
      );
    }

    const result = await prisma.$transaction(updateOps);
    const updated = result[0];
    if (user.familyId) {
      const heartsResult = result[1] as { count: number };
      if (heartsResult.count === 0) {
        throw Errors.badRequest('하트가 부족합니다. 답변 수정에는 하트 1개가 필요합니다.');
      }
    }

    return this.toAnswerResponse(updated);
  }

  /**
   * 답변 삭제
   */
  async deleteAnswer(userId: string, answerId: string): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { userId },
    });

    if (!user) {
      throw Errors.notFound('사용자');
    }

    const normalizedDeleteId = answerId.toLowerCase();
    const answer = await prisma.answer.findUnique({
      where: { id: normalizedDeleteId },
    });

    if (!answer) {
      throw Errors.notFound('답변');
    }

    if (answer.userId !== user.id) {
      throw Errors.forbidden('본인의 답변만 삭제할 수 있습니다.');
    }

    await prisma.answer.delete({
      where: { id: normalizedDeleteId },
    });

  }

  private toAnswerResponse(
    answer: {
      id: string;
      content: string;
      imageUrl: string | null;
      moodId?: string | null;
      questionId: string;
      createdAt: Date;
      updatedAt: Date;
      user: {
        id: string;
        email: string;
        name: string;
        profileImageUrl: string | null;
        role: string;
        familyId: string | null;
        hearts: number;
        moodId?: string | null;
        createdAt: Date;
      };
    },
    nicknameMap?: Map<string, string>,
    colorMap?: Map<string, string>
  ): AnswerResponse {
    // 답변 자체의 moodId 우선, 없으면 사용자의 현재 colorId
    const resolvedMoodId = answer.moodId ?? colorMap?.get(answer.user.id) ?? answer.user.moodId ?? null;
    return {
      id: answer.id,
      content: answer.content,
      imageUrl: answer.imageUrl,
      questionId: answer.questionId,
      createdAt: answer.createdAt,
      updatedAt: answer.updatedAt,
      user: {
        id: answer.user.id,
        email: answer.user.email,
        name: nicknameMap?.get(answer.user.id) ?? answer.user.name,
        profileImageUrl: answer.user.profileImageUrl,
        role: answer.user.role as UserResponse['role'],
        familyId: answer.user.familyId,
        hearts: answer.user.hearts,
        moodId: resolvedMoodId,
        createdAt: answer.user.createdAt,
        heartGrantedToday: false,
      },
    };
  }
}
