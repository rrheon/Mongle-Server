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
import { tryFinalizeDailyQuestion } from './dailyQuestionCompletion';
import { NotificationService } from './NotificationService';
import { PushNotificationService } from './PushNotificationService';
import { getPushMessages } from '../utils/i18n/push';

export class QuestionService {
  /**
   * Accept-Language 헤더에서 지원 언어 추출
   */
  resolveLanguage(acceptLanguage?: string): 'ko' | 'en' | 'ja' {
    if (!acceptLanguage) return 'ko';
    const lang = acceptLanguage.split(',')[0].trim().toLowerCase().slice(0, 2);
    if (lang === 'ja') return 'ja';
    if (lang === 'en') return 'en';
    return 'ko';
  }

  /**
   * 언어에 맞는 content 반환
   */
  private localizedContent(
    question: { content: string; contentEn?: string | null; contentJa?: string | null },
    lang: 'ko' | 'en' | 'ja'
  ): string {
    if (lang === 'en' && question.contentEn) return question.contentEn;
    if (lang === 'ja' && question.contentJa) return question.contentJa;
    return question.content;
  }

  /**
   * 오늘의 질문 조회 (가족별)
   * - 오늘 질문이 없으면 랜덤 배정
   */
  async getTodayQuestion(userId: string, lang: 'ko' | 'en' | 'ja' = 'ko'): Promise<DailyQuestionResponse> {
    const user = await prisma.user.findUnique({ where: { userId } });
    if (!user) throw Errors.notFound('사용자');
    if (!user.familyId) throw Errors.badRequest('그룹에 속해 있지 않습니다.');

    const today = this.getToday();
    const familyId = user.familyId;

    let dailyQuestion = await prisma.dailyQuestion.findUnique({
      where: { familyId_date: { familyId, date: today } },
      include: { question: true },
    });

    if (!dailyQuestion) {
      // MG-16: 자동교체 없음. 가장 최근 DQ를 무기한 carry over.
      // - 미완료면 그대로 (전원 답변 대기 중)
      // - 완료됐는데 오늘자가 없으면 (스케줄러 발급 전) 그대로 (다음 11시까지 대기)
      // - DQ가 아예 없으면 (신규 가족 등) 즉시 배정
      const latestDQ = await prisma.dailyQuestion.findFirst({
        where: { familyId, date: { lt: today } },
        include: { question: true },
        orderBy: { date: 'desc' },
      });

      if (latestDQ) {
        return this.toDailyQuestionResponse(latestDQ, user.id, familyId, lang);
      }

      // 첫 질문이 한 번도 없는 경우(가입 직후 등) → 즉시 배정
      dailyQuestion = await this.assignQuestionToFamily(familyId, today);
    }

    return this.toDailyQuestionResponse(dailyQuestion, user.id, familyId, lang);
  }

  /**
   * 특정 질문에 대해 해당 가족의 모든 멤버가 답변 또는 패스했는지 확인.
   *
   * 이전 구현은 "배정일 KST 1일 윈도우 안에 작성된 답변" 만 카운트했지만,
   * 그러면 배정 다음날 이후에 답변이 들어온 경우 완료 판정이 영원히 안 돼서
   * 답변이 history 에서 사라지는 버그가 있었다.
   *
   * 이제는 해당 questionId 에 대한 그룹 멤버의 답변을 시간 제한 없이 집계하고,
   * 완료된 시점에 tryFinalizeDailyQuestion() 이 DailyQuestion.completedAt 을 기록하는
   * 방식으로 처리한다. DQ.date 는 배정일로 고정(@@unique 충돌 방지).
   */
  private async isQuestionCompleted(familyId: string, questionId: string, date: Date): Promise<boolean> {
    const memberships = await prisma.familyMembership.findMany({
      where: { familyId },
      select: { userId: true, skippedDate: true },
    });

    const answeredUserIds = new Set(
      (await prisma.answer.findMany({
        where: {
          questionId,
          userId: { in: memberships.map((m) => m.userId) },
        },
        select: { userId: true },
      })).map((a) => a.userId)
    );

    return memberships.every(
      (m) =>
        answeredUserIds.has(m.userId) ||
        this.isSameDate(m.skippedDate, date)
    );
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
    if (!user.familyId) throw Errors.badRequest('그룹에 속해 있지 않습니다.');

    const today = this.getToday();
    const familyId = user.familyId;

    // 실제 활성 질문 조회 (getTodayQuestion과 동일 로직)
    let dailyQuestion = await prisma.dailyQuestion.findUnique({
      where: { familyId_date: { familyId, date: today } },
      include: { question: true },
    });

    if (!dailyQuestion) {
      // MG-16: 자동교체 없음. 가장 최근 DQ를 무기한 carry over.
      const latestDQ = await prisma.dailyQuestion.findFirst({
        where: { familyId, date: { lt: today } },
        include: { question: true },
        orderBy: { date: 'desc' },
      });
      if (latestDQ) dailyQuestion = latestDQ;
    }

    if (!dailyQuestion) throw Errors.notFound('오늘의 질문');

    // skippedDate는 실제 질문 날짜 사용 (전날 미완료 질문일 수 있음)
    const questionDate = dailyQuestion.date;

    // 하트 잔액 및 이미 패스했는지 확인
    const membership = await prisma.familyMembership.findUnique({
      where: { userId_familyId: { userId: user.id, familyId } },
    });

    if (!membership) throw Errors.notFound('멤버십');

    // 이미 해당 질문을 패스했는지 확인
    const alreadySkipped = this.isSameDate(membership.skippedDate, questionDate);
    if (alreadySkipped) {
      throw Errors.conflict('이미 질문을 패스했습니다.');
    }

    const currentHearts = membership.hearts ?? 0;
    if (currentHearts < 3) {
      throw Errors.badRequest('하트가 부족합니다. 질문을 패스하려면 하트 3개가 필요합니다.');
    }

    // 이미 답변한 경우 패스 불가
    const myAnswer = await prisma.answer.findFirst({
      where: { questionId: dailyQuestion.question.id, userId: user.id },
    });
    if (myAnswer) {
      throw Errors.conflict('이미 답변한 질문은 패스할 수 없습니다.');
    }

    // skippedDate = 질문 날짜, 하트 -3 (원자적 처리)
    const [updatedMembership] = await prisma.$transaction([
      prisma.familyMembership.update({
        where: { userId_familyId: { userId: user.id, familyId } },
        data: { skippedDate: questionDate, hearts: { decrement: 3 } },
      }),
    ]);

    // 이번 패스로 그룹 전원이 완료 상태가 되었다면 DQ.date 를 오늘(KST)로 이동
    try {
      await tryFinalizeDailyQuestion({
        familyId,
        dailyQuestionId: dailyQuestion.id,
      });
    } catch (e) {
      console.warn('[Skip] DQ finalize 실패:', e);
    }

    return {
      message: '질문을 패스했습니다. 다른 멤버의 답변을 확인해보세요.',
      heartsRemaining: updatedMembership.hearts,
    };
  }

  /**
   * 특정 날짜의 질문 조회 (가족별)
   */
  async getQuestionByDate(userId: string, dateStr: string, lang: 'ko' | 'en' | 'ja' = 'ko'): Promise<DailyQuestionResponse | null> {
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

    return this.toDailyQuestionResponse(dailyQuestion, user.id, user.familyId, lang);
  }

  /**
   * 질문 상세 조회
   */
  async getQuestion(questionId: string, lang: 'ko' | 'en' | 'ja' = 'ko'): Promise<QuestionResponse> {
    const question = await prisma.question.findUnique({ where: { id: questionId } });
    if (!question) throw Errors.notFound('질문');
    return this.toQuestionResponse(question, lang);
  }

  /**
   * 가족 질문 히스토리 — 답변 포함 (단일 쿼리, N+1 없음)
   */
  async getQuestionHistory(
    userId: string,
    page: number,
    limit: number,
    lang: 'ko' | 'en' | 'ja' = 'ko'
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
    // 히스토리 정렬: completedAt 있으면 우선 (완료일자 기준), 없으면 date 폴백.
    // Prisma 는 COALESCE orderBy 를 직접 지원하지 않으므로 [completedAt desc nulls last, date desc]
    // 조합으로 근사한다 — 완료된 질문은 완료일자 내림차순, 미완료 질문은 뒤에서 배정일 내림차순.
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
        orderBy: [
          { completedAt: { sort: 'desc', nulls: 'last' } },
          { date: 'desc' },
        ],
        skip,
        take: limit,
      }),
      prisma.dailyQuestion.count({
        where: { familyId: user.familyId, date: { lte: today } },
      }),
    ]);

    const data: DailyQuestionHistoryResponse[] = dailyQuestions.map((dq) => {
      // 해당 질문에 대한 그룹 멤버들의 답변 전체를 포함.
      // (이전에는 "DQ.date 기준 KST 하루 창" 으로 필터링했으나, 배정일 다음날 이후에
      //  답변이 들어온 경우 history 에서 사라지는 데이터 손실 버그가 있었다.
      //  완료 시점에 DQ.date 자체가 완료일자로 이동하므로 윈도우 필터 불필요.)
      const answers = dq.question.answers;
      const answerSummaries: HistoryAnswerSummary[] = answers.map((a) => ({
        id: a.id,
        userId: a.userId,
        userName: nicknameMap.get(a.userId) ?? a.user.name,
        content: a.content,
        imageUrl: a.imageUrl,
        moodId: (a as any).moodId ?? null,
      }));

      const hasMySkipped = this.isSameDate(myMembership?.skippedDate, dq.date);

      const answeredUserIds = new Set(answers.map((a) => a.userId));
      const memberAnswerStatuses = familyMemberships.map((m) => {
        if (answeredUserIds.has(m.userId)) {
          return {
            userId: m.userId,
            userName: m.nickname ?? m.user.name,
            colorId: m.colorId ?? m.user.moodId ?? 'loved',
            status: 'answered' as const,
          };
        }
        const skipped = this.isSameDate(m.skippedDate, dq.date);
        return {
          userId: m.userId,
          userName: m.nickname ?? m.user.name,
          colorId: m.colorId ?? m.user.moodId ?? 'loved',
          status: skipped ? ('skipped' as const) : ('not_answered' as const),
        };
      });

      // 히스토리 노출일: 완료 시점 기준 (KST). 미완료 질문은 배정일(date) 폴백.
      // 예) 20일 배정 → 21일 모든 멤버 답변 완료 → 히스토리에서 21일로 노출.
      // completedAt 은 UTC 타임스탬프이므로 KST 변환 헬퍼 사용 (split('T') 금지).
      const displayDate = dq.completedAt
        ? this.toKstDateString(dq.completedAt)
        : this.toKstDateString(dq.date);

      return {
        id: dq.id,
        question: this.toQuestionResponse(dq.question, lang),
        date: displayDate,
        assignedDate: this.toKstDateString(dq.date),
        completedAt: dq.completedAt?.toISOString() ?? null,
        familyId: dq.familyId,
        isSkipped: dq.isSkipped,
        skippedAt: dq.skippedAt?.toISOString() ?? null,
        hasMyAnswer: answers.some((a) => a.userId === user.id),
        hasMySkipped,
        familyAnswerCount: answers.length,
        answers: answerSummaries,
        memberAnswerStatuses,
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
  async createCustomQuestion(userId: string, content: string, lang: 'ko' | 'en' | 'ja' = 'ko'): Promise<CreateCustomQuestionResponse> {
    const user = await prisma.user.findUnique({ where: { userId } });
    if (!user) throw Errors.notFound('사용자');
    if (!user.familyId) throw Errors.badRequest('그룹에 속해 있지 않습니다.');
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
      throw Errors.conflict('이미 그룹 멤버 중 누군가가 답변했습니다. 답변이 없을 때만 나만의 질문을 작성할 수 있습니다.');
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

    const questionResponse = await this.toDailyQuestionResponse(updatedDaily, user.id, familyId, lang);

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
   * 가족에게 질문 배정 (최근 30일 제외).
   * MG-16: 가족 생성 직후 첫 질문 발급에도 사용되므로 public.
   *
   * DQ 생성 후 가족 멤버 전원에게 NEW_QUESTION DB 알림 + APNs/FCM 푸시 발송.
   * 스케줄러/FamilyService/getTodayQuestion 어느 경로로 들어와도 알림이 누락되지 않도록
   * 단일 진입점에서 처리. 알림/푸시 실패는 best-effort 로 삼키고 DQ 반환은 계속한다
   * (가족 생성 흐름이 푸시 실패로 끊기면 UX 더 나빠짐).
   */
  async assignQuestionToFamily(familyId: string, date: Date) {
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

    const created = await prisma.dailyQuestion.create({
      data: { questionId: selected.id, familyId, date },
      include: { question: true },
    });

    await notifyNewQuestion(familyId).catch((e) => {
      console.warn(`[QuestionService] NEW_QUESTION 알림 실패 family=${familyId}:`, e);
    });

    return created;
  }

  private getToday(): Date {
    const now = new Date();
    // 한국 표준시(KST, UTC+9) 기준 날짜 문자열 획득
    const kstDateStr = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }); // "YYYY-MM-DD"
    // Prisma @db.Date는 UTC 기준으로 날짜를 저장하므로, KST 날짜를 UTC 자정으로 생성
    return new Date(kstDateStr + 'T00:00:00.000Z');
  }

  /**
   * Date → "YYYY-MM-DD" (KST 기준).
   *
   * `toISOString().split('T')[0]` 은 UTC 기준이라 KST 새벽(00:00~09:00)에 찍힌
   * `completedAt` 이 하루 앞당겨 표시되는 off-by-one 이 발생한다.
   * 히스토리 노출일 같은 KST 사용자 시점의 달력 배치에는 반드시 이 헬퍼를 사용한다.
   */
  private toKstDateString(date: Date): string {
    return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
  }

  /**
   * @db.Date 필드의 안전한 날짜 비교 (타임존 차이로 인한 getTime() 불일치 방지)
   */
  private isSameDate(a: Date | null | undefined, b: Date | null | undefined): boolean {
    if (!a || !b) return false;
    return a.toISOString().split('T')[0] === b.toISOString().split('T')[0];
  }

  private async toDailyQuestionResponse(
    dailyQuestion: {
      id: string;
      date: Date;
      familyId: string;
      isSkipped: boolean;
      skippedAt: Date | null;
      question: { id: string; content: string; contentEn?: string | null; contentJa?: string | null; category: string; createdAt: Date; isCustom: boolean };
    },
    userId: string,
    familyId: string,
    lang: 'ko' | 'en' | 'ja' = 'ko'
  ): Promise<DailyQuestionResponse> {
    const [memberships, myMembership] = await Promise.all([
      prisma.familyMembership.findMany({
        where: { familyId },
        select: { userId: true, nickname: true, colorId: true, skippedDate: true, user: { select: { id: true, name: true, moodId: true } } },
      }),
      prisma.familyMembership.findUnique({
        where: { userId_familyId: { userId, familyId } },
        select: { skippedDate: true },
      }),
    ]);
    const memberIds = memberships.map((m) => m.userId);

    // 가족 멤버의 답변 조회 (questionId + userId unique constraint로 중복 없음)
    const answers = await prisma.answer.findMany({
      where: {
        questionId: dailyQuestion.question.id,
        userId: { in: memberIds },
      },
      select: { userId: true },
    });

    const answeredUserIds = new Set(answers.map((a) => a.userId));

    // 오늘 패스 여부: membership.skippedDate가 이 dailyQuestion의 날짜와 같으면 true
    const hasMySkipped = this.isSameDate(myMembership?.skippedDate, dailyQuestion.date);

    // 각 멤버의 답변/스킵/미답변 상태
    const memberAnswerStatuses = memberships.map((m) => {
      if (answeredUserIds.has(m.userId)) {
        return {
          userId: m.userId,
          userName: m.nickname ?? m.user.name,
          colorId: m.colorId ?? m.user.moodId ?? 'loved',
          status: 'answered' as const,
        };
      }
      const skipped = this.isSameDate(m.skippedDate, dailyQuestion.date);
      return {
        userId: m.userId,
        userName: m.nickname ?? m.user.name,
        colorId: m.colorId ?? m.user.moodId ?? 'loved',
        status: skipped ? ('skipped' as const) : ('not_answered' as const),
      };
    });

    return {
      id: dailyQuestion.id,
      question: this.toQuestionResponse(dailyQuestion.question, lang),
      date: dailyQuestion.date.toISOString().split('T')[0],
      familyId: dailyQuestion.familyId,
      isSkipped: dailyQuestion.isSkipped,
      skippedAt: dailyQuestion.skippedAt?.toISOString() ?? null,
      hasMyAnswer: answeredUserIds.has(userId),
      hasMySkipped,
      familyAnswerCount: answers.length,
      memberAnswerStatuses,
    };
  }

  private toQuestionResponse(question: {
    id: string;
    content: string;
    contentEn?: string | null;
    contentJa?: string | null;
    category: string;
    createdAt: Date;
    isCustom?: boolean;
  }, lang: 'ko' | 'en' | 'ja' = 'ko'): QuestionResponse {
    return {
      id: question.id,
      content: this.localizedContent(question, lang),
      category: question.category as QuestionResponse['category'],
      createdAt: question.createdAt,
      isCustom: question.isCustom ?? false,
    };
  }
}

/**
 * 가족 멤버 전원에게 NEW_QUESTION DB 알림 저장 + APNs/FCM 푸시 발송.
 *
 * scheduler.ts 와 QuestionService.assignQuestionToFamily 가 공유하는 로직.
 * 개별 멤버/채널 실패는 로그만 남기고 삼켜, 한 유저 실패가 다른 유저 발송을 막지 않음.
 * 호출처는 이 함수 자체의 throw 에 대비해 상위에서 catch 권장.
 */
async function notifyNewQuestion(familyId: string): Promise<void> {
  const notifSvc = new NotificationService();
  const pushSvc = new PushNotificationService();

  // FamilyMembership 기반 조회 — User.familyId 단일 컬럼은 유저의 "현재 활성 가족" 1개만
  // 가리키므로, 멤버가 다른 그룹을 활성으로 두면 매칭 0건이 되어 알림이 누락되던 버그(MG-29)
  // 수정. 스케줄러(scheduler.ts)·리마인더(reminderScheduler.ts)와 동일한 N:M 진실 사용.
  const memberships = await prisma.familyMembership.findMany({
    where: { familyId },
    select: {
      user: {
        select: {
          id: true,
          apnsToken: true,
          apnsEnvironment: true,
          fcmToken: true,
          locale: true,
          notifQuestion: true,
        },
      },
    },
  });
  const members = memberships.map((m) => m.user);

  const tasks: Promise<unknown>[] = [];
  for (const m of members) {
    const msgs = getPushMessages(m.locale);
    const title = msgs.newQuestion.title;
    const body = msgs.newQuestion.body;

    tasks.push(
      notifSvc.createNotification(m.id, 'NEW_QUESTION', title, body, familyId).catch((e) => {
        console.warn(`[notifyNewQuestion] DB 알림 실패 user=${m.id} family=${familyId}:`, e);
      })
    );

    if (!m.notifQuestion) continue;

    if (m.apnsToken) {
      tasks.push(
        (async () => {
          const badge = await notifSvc.getUnreadCount(m.id);
          await pushSvc.sendApnsPush(m.apnsToken!, title, body, 'NEW_QUESTION', badge, m.apnsEnvironment);
        })().catch((e) => {
          console.warn(`[notifyNewQuestion] APNs 실패 user=${m.id}:`, e);
        })
      );
    }
    if (m.fcmToken) {
      tasks.push(
        pushSvc.sendFcmPush(m.fcmToken, title, body, 'NEW_QUESTION').catch((e) => {
          console.warn(`[notifyNewQuestion] FCM 실패 user=${m.id}:`, e);
        })
      );
    }
  }
  await Promise.all(tasks);
}

export { notifyNewQuestion };
