import prisma from '../utils/prisma';
import {
  QuestionResponse,
  DailyQuestionResponse,
  DailyQuestionHistoryResponse,
  HistoryAnswerSummary,
  SkipQuestionResponse,
  CreateCustomQuestionResponse,
  PaginatedResponse,
} from '../models';
import { Errors } from '../middleware/errorHandler';

export class QuestionService {
  /**
   * 오늘의 질문 조회 (가족별)
   * - 오늘 질문이 없으면 랜덤 배정
   */
  async getTodayQuestion(userId: string): Promise<DailyQuestionResponse> {
    const user = await prisma.user.findUnique({ where: { userId } });
    if (!user) throw Errors.notFound('사용자');
    if (!user.familyId) throw Errors.badRequest('가족에 속해 있지 않습니다.');

    const today = this.getToday();

    let dailyQuestion = await prisma.dailyQuestion.findUnique({
      where: { familyId_date: { familyId: user.familyId, date: today } },
      include: { question: true },
    });

    if (!dailyQuestion) {
      dailyQuestion = await this.assignQuestionToFamily(user.familyId, today);
    }

    return this.toDailyQuestionResponse(dailyQuestion, user.id, user.familyId);
  }

  /**
   * 오늘의 질문 개인 패스 (사용자별, 하루 1회)
   * - 질문은 그룹 전체에 유지 (변경 없음)
   * - 패스한 사용자의 FamilyMembership.skippedDate = 오늘로 기록
   * - 하트 3개 차감
   * - 패스 후 다른 사람 답변 열람 가능 (hasMySkipped=true)
   */
  async skipTodayQuestion(userId: string): Promise<SkipQuestionResponse> {
    const user = await prisma.user.findUnique({ where: { userId } });
    if (!user) throw Errors.notFound('사용자');
    if (!user.familyId) throw Errors.badRequest('가족에 속해 있지 않습니다.');

    const today = this.getToday();

    // 하트 잔액 및 이미 패스했는지 확인
    const membership = await prisma.familyMembership.findUnique({
      where: { userId_familyId: { userId: user.id, familyId: user.familyId } },
    });

    if (!membership) throw Errors.notFound('멤버십');

    // 이미 오늘 패스했는지 확인
    const alreadySkipped =
      membership.skippedDate !== null &&
      membership.skippedDate.getTime() === today.getTime();
    if (alreadySkipped) {
      throw Errors.conflict('오늘 이미 질문을 패스했습니다. 하루 1회만 패스할 수 있습니다.');
    }

    const currentHearts = membership.hearts ?? 0;
    if (currentHearts < 3) {
      throw Errors.badRequest('하트가 부족합니다. 질문을 패스하려면 하트 3개가 필요합니다.');
    }

    // 이미 답변한 경우 패스 불가
    const dailyQuestion = await prisma.dailyQuestion.findUnique({
      where: { familyId_date: { familyId: user.familyId, date: today } },
    });
    if (dailyQuestion) {
      const myAnswer = await prisma.answer.findFirst({
        where: { questionId: dailyQuestion.questionId, userId: user.id },
      });
      if (myAnswer) {
        throw Errors.conflict('이미 답변한 질문은 패스할 수 없습니다.');
      }
    }

    // skippedDate = 오늘, 하트 -3 (원자적 처리)
    const [updatedMembership] = await prisma.$transaction([
      prisma.familyMembership.update({
        where: { userId_familyId: { userId: user.id, familyId: user.familyId } },
        data: { skippedDate: today, hearts: { decrement: 3 } },
      }),
    ]);

    return {
      message: '질문을 패스했습니다. 다른 가족의 답변을 확인해보세요.',
      heartsRemaining: updatedMembership.hearts,
    };
  }

  /**
   * 특정 날짜의 질문 조회 (가족별)
   */
  async getQuestionByDate(userId: string, dateStr: string): Promise<DailyQuestionResponse | null> {
    const user = await prisma.user.findUnique({ where: { userId } });
    if (!user) throw Errors.notFound('사용자');
    if (!user.familyId) return null;

    // "YYYY-MM-DD" 형식의 날짜 문자열을 UTC 자정으로 파싱 (서버 타임존 무관)
    const date = new Date(dateStr + 'T00:00:00.000Z');

    const dailyQuestion = await prisma.dailyQuestion.findUnique({
      where: { familyId_date: { familyId: user.familyId, date } },
      include: { question: true },
    });

    if (!dailyQuestion) return null;

    return this.toDailyQuestionResponse(dailyQuestion, user.id, user.familyId);
  }

  /**
   * 질문 상세 조회
   */
  async getQuestion(questionId: string): Promise<QuestionResponse> {
    const question = await prisma.question.findUnique({ where: { id: questionId } });
    if (!question) throw Errors.notFound('질문');
    return this.toQuestionResponse(question);
  }

  /**
   * 가족 질문 히스토리 — 답변 포함 (단일 쿼리, N+1 없음)
   */
  async getQuestionHistory(
    userId: string,
    page: number,
    limit: number
  ): Promise<PaginatedResponse<DailyQuestionHistoryResponse>> {
    const user = await prisma.user.findUnique({ where: { userId } });
    if (!user) throw Errors.notFound('사용자');
    if (!user.familyId) {
      return { data: [], pagination: { page, limit, total: 0, totalPages: 0 } };
    }

    const skip = (page - 1) * limit;
    const today = this.getToday();

    // FamilyMembership 기반 구성원 조회 + 현재 사용자 패스 날짜
    const familyMemberships = await prisma.familyMembership.findMany({
      where: { familyId: user.familyId },
      select: { userId: true, colorId: true, nickname: true, skippedDate: true, user: { select: { moodId: true, name: true } } },
    });
    const myMembership = familyMemberships.find((m) => m.userId === user.id);
    const memberIds = familyMemberships.map((m) => m.userId);
    const colorMap = new Map(
      familyMemberships.map((m) => [m.userId, m.colorId ?? m.user.moodId ?? 'loved'])
    );
    const nicknameMap = new Map(
      familyMemberships.map((m) => [m.userId, m.nickname ?? m.user.name])
    );

    // dailyQuestion + question + 해당 질문의 가족 답변을 한 번에 조회 (N+1 제거)
    const [dailyQuestions, total] = await Promise.all([
      prisma.dailyQuestion.findMany({
        where: { familyId: user.familyId, date: { lte: today } },
        include: {
          question: {
            include: {
              answers: {
                where: { userId: { in: memberIds } },
                include: { user: { select: { id: true, name: true, familyId: true } } },
              },
            },
          },
        },
        orderBy: { date: 'desc' },
        skip,
        take: limit,
      }),
      prisma.dailyQuestion.count({
        where: { familyId: user.familyId, date: { lte: today } },
      }),
    ]);

    const data: DailyQuestionHistoryResponse[] = dailyQuestions.map((dq) => {
      // 해당 DailyQuestion의 KST 날짜 범위 내에 작성된 답변만 포함
      // (다른 날짜나 다른 가족 컨텍스트에서 같은 질문에 작성된 답변 누출 방지)
      const kstDayStart = new Date(dq.date.getTime() - 9 * 60 * 60 * 1000);
      const kstDayEnd = new Date(dq.date.getTime() + 15 * 60 * 60 * 1000);
      const answers = dq.question.answers.filter(
        (a) => a.createdAt >= kstDayStart && a.createdAt < kstDayEnd
      );
      const answerSummaries: HistoryAnswerSummary[] = answers.map((a) => ({
        id: a.id,
        userId: a.userId,
        userName: nicknameMap.get(a.userId) ?? a.user.name,
        content: a.content,
        imageUrl: a.imageUrl,
        moodId: (a as any).moodId ?? null,
      }));

      const hasMySkipped =
        myMembership?.skippedDate != null &&
        myMembership.skippedDate.getTime() === dq.date.getTime();

      return {
        id: dq.id,
        question: this.toQuestionResponse(dq.question),
        date: dq.date.toISOString().split('T')[0],
        familyId: dq.familyId,
        isSkipped: dq.isSkipped,
        skippedAt: dq.skippedAt?.toISOString() ?? null,
        hasMyAnswer: answers.some((a) => a.userId === user.id),
        hasMySkipped,
        familyAnswerCount: answers.length,
        answers: answerSummaries,
      };
    });

    return {
      data,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }


  /**
   * 나만의 질문 작성 (하트 3개 차감, 하루 1회 제한)
   * - 이미 오늘 나만의 질문이 등록된 경우 거부
   * - 하트 3개 이상 보유 필요
   */
  async createCustomQuestion(userId: string, content: string): Promise<CreateCustomQuestionResponse> {
    const user = await prisma.user.findUnique({ where: { userId } });
    if (!user) throw Errors.notFound('사용자');
    if (!user.familyId) throw Errors.badRequest('가족에 속해 있지 않습니다.');
    const familyId = user.familyId;

    // 하트 잔액 확인 (3개 이상 필요 — FamilyMembership 기준)
    const membership = await prisma.familyMembership.findUnique({
      where: { userId_familyId: { userId: user.id, familyId } },
    });
    const currentHearts = membership?.hearts ?? 0;
    if (currentHearts < 3) {
      throw Errors.badRequest('하트가 부족합니다. 나만의 질문을 등록하려면 하트 3개가 필요합니다.');
    }

    const today = this.getToday();

    const current = await prisma.dailyQuestion.findUnique({
      where: { familyId_date: { familyId, date: today } },
      include: { question: true },
    });

    if (!current) throw Errors.notFound('오늘의 질문');

    // 이미 나만의 질문이 등록된 경우 거부
    if (current.question.isCustom) {
      throw Errors.conflict('오늘 이미 나만의 질문이 등록되었습니다. 하루 1회만 등록할 수 있습니다.');
    }

    // 그룹 내 누군가가 이미 답변한 경우 거부
    const familyMemberIds = await prisma.familyMembership.findMany({
      where: { familyId },
      select: { userId: true },
    });
    const memberUserIds = familyMemberIds.map((m) => m.userId);
    const kstDayStart = new Date(today.getTime() - 9 * 60 * 60 * 1000);
    const kstDayEnd = new Date(today.getTime() + 15 * 60 * 60 * 1000);
    const existingAnswerCount = await prisma.answer.count({
      where: {
        questionId: current.questionId,
        userId: { in: memberUserIds },
        createdAt: { gte: kstDayStart, lt: kstDayEnd },
      },
    });
    if (existingAnswerCount > 0) {
      throw Errors.conflict('이미 가족 중 누군가가 답변했습니다. 답변이 없을 때만 나만의 질문을 작성할 수 있습니다.');
    }

    const trimmedContent = content.trim();
    if (!trimmedContent) throw Errors.badRequest('질문 내용을 입력해주세요.');
    if (trimmedContent.length > 200) throw Errors.badRequest('질문은 200자 이내로 입력해주세요.');

    // 나만의 질문 생성 + DailyQuestion 교체 + 하트 -3 (원자적 처리)
    // - 세 작업을 하나의 트랜잭션으로 묶어 부분 실패 방지
    const { updatedDaily } = await prisma.$transaction(async (tx) => {
      const newQuestion = await tx.question.create({
        data: {
          content: trimmedContent,
          category: 'DAILY',
          isActive: false,  // 랜덤 풀에서 제외
          isCustom: true,
        },
      });

      await tx.familyMembership.updateMany({
        where: { userId: user.id, familyId },
        data: { hearts: { decrement: 3 } },
      });

      const daily = await tx.dailyQuestion.update({
        where: { id: current.id },
        data: { questionId: newQuestion.id },
        include: { question: true },
      });

      return { updatedDaily: daily };
    });

    const questionResponse = await this.toDailyQuestionResponse(updatedDaily, user.id, familyId);

    const updatedMembership = await prisma.familyMembership.findUnique({
      where: { userId_familyId: { userId: user.id, familyId } },
    });

    return {
      message: '나만의 질문이 오늘의 질문으로 등록되었습니다.',
      newQuestion: questionResponse,
      heartsRemaining: updatedMembership?.hearts ?? 0,
    };
  }

  /**
   * 가족에게 질문 배정 (최근 30일 제외)
   */
  private async assignQuestionToFamily(familyId: string, date: Date) {
    const recentDate = new Date(date);
    recentDate.setDate(recentDate.getDate() - 30);

    const usedQuestionIds = await prisma.dailyQuestion.findMany({
      where: { familyId, date: { gte: recentDate } },
      select: { questionId: true },
    });
    const usedIds = usedQuestionIds.map((q) => q.questionId);

    let questionPool = await prisma.question.findMany({
      where: { isActive: true, id: { notIn: usedIds } },
    });

    if (questionPool.length === 0) {
      questionPool = await prisma.question.findMany({ where: { isActive: true } });
    }

    if (questionPool.length === 0) throw Errors.internal('사용 가능한 질문이 없습니다.');

    const selected = questionPool[Math.floor(Math.random() * questionPool.length)];

    return prisma.dailyQuestion.create({
      data: { questionId: selected.id, familyId, date },
      include: { question: true },
    });
  }

  private getToday(): Date {
    const now = new Date();
    // 한국 표준시(KST, UTC+9) 기준 날짜 문자열 획득
    const kstDateStr = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }); // "YYYY-MM-DD"
    // Prisma @db.Date는 UTC 기준으로 날짜를 저장하므로, KST 날짜를 UTC 자정으로 생성
    return new Date(kstDateStr + 'T00:00:00.000Z');
  }

  private async toDailyQuestionResponse(
    dailyQuestion: {
      id: string;
      date: Date;
      familyId: string;
      isSkipped: boolean;
      skippedAt: Date | null;
      question: { id: string; content: string; category: string; createdAt: Date; isCustom: boolean };
    },
    userId: string,
    familyId: string
  ): Promise<DailyQuestionResponse> {
    const [familyMembers, membership] = await Promise.all([
      prisma.user.findMany({ where: { familyId }, select: { id: true } }),
      prisma.familyMembership.findUnique({
        where: { userId_familyId: { userId, familyId } },
        select: { skippedDate: true },
      }),
    ]);
    const memberIds = familyMembers.map((m) => m.id);

    // getHistory와 동일한 KST 날짜 범위 필터 적용 (다른 날짜의 같은 질문 답변 누출 방지)
    const kstDayStart = new Date(dailyQuestion.date.getTime() - 9 * 60 * 60 * 1000);
    const kstDayEnd = new Date(dailyQuestion.date.getTime() + 15 * 60 * 60 * 1000);
    const answers = await prisma.answer.findMany({
      where: {
        questionId: dailyQuestion.question.id,
        userId: { in: memberIds },
        createdAt: { gte: kstDayStart, lt: kstDayEnd },
      },
      select: { userId: true },
    });

    // 오늘 패스 여부: membership.skippedDate가 이 dailyQuestion의 날짜와 같으면 true
    const hasMySkipped =
      membership?.skippedDate !== null &&
      membership?.skippedDate !== undefined &&
      membership.skippedDate.getTime() === dailyQuestion.date.getTime();

    return {
      id: dailyQuestion.id,
      question: this.toQuestionResponse(dailyQuestion.question),
      date: dailyQuestion.date.toISOString().split('T')[0],
      familyId: dailyQuestion.familyId,
      isSkipped: dailyQuestion.isSkipped,
      skippedAt: dailyQuestion.skippedAt?.toISOString() ?? null,
      hasMyAnswer: answers.some((a) => a.userId === userId),
      hasMySkipped,
      familyAnswerCount: answers.length,
    };
  }

  private toQuestionResponse(question: {
    id: string;
    content: string;
    category: string;
    createdAt: Date;
    isCustom?: boolean;
  }): QuestionResponse {
    return {
      id: question.id,
      content: question.content,
      category: question.category as QuestionResponse['category'],
      createdAt: question.createdAt,
      isCustom: question.isCustom ?? false,
    };
  }
}
