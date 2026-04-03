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
    if (user.familyId) {
      const dailyQuestion = await prisma.dailyQuestion.findFirst({
        where: { questionId: normalizedQuestionId, familyId: user.familyId },
      });
      if (!dailyQuestion) {
        throw Errors.badRequest('이 질문은 가족에 배정되지 않았습니다.');
      }
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
      const otherMembers = await prisma.user.findMany({
        where: { familyId: user.familyId, id: { not: user.id } },
        select: { id: true, apnsToken: true, fcmToken: true },
      });

      const title = `${user.name}님이 답변했어요!`;
      const body = '오늘의 질문에 새 답변이 올라왔어요. 확인해보세요 🌿';

      for (const member of otherMembers) {
        notificationService.createNotification(member.id, 'MEMBER_ANSWERED', title, body, user.familyId).catch(() => {});
        if (member.apnsToken) pushService.sendApnsPush(member.apnsToken, title, body, 'MEMBER_ANSWERED').catch(() => {});
        if (member.fcmToken) pushService.sendFcmPush(member.fcmToken, title, body, 'MEMBER_ANSWERED').catch(() => {});
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
        user: {
          familyId: user.familyId,
        },
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

    // 답변 수정 + 하트 차감 + colorId 업데이트를 원자적으로 처리
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

    // 하트 1개 차감 (가족 소속인 경우)
    if (user.familyId) {
      updateOps.push(
        prisma.familyMembership.updateMany({
          where: { userId: user.id, familyId: user.familyId },
          data: {
            hearts: { decrement: 1 },
            ...(data.moodId && { colorId: data.moodId }),
          },
        })
      );
    }

    const [updated] = await prisma.$transaction(updateOps);

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
      },
    };
  }
}
