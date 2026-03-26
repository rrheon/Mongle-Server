const mockPrismaUserFindUnique = jest.fn();
const mockPrismaFamilyMembershipFindUnique = jest.fn();
const mockPrismaFamilyMembershipFindMany = jest.fn();
const mockPrismaFamilyMembershipUpdate = jest.fn();
const mockPrismaFamilyMembershipUpdateMany = jest.fn();
const mockPrismaQuestionFindUnique = jest.fn();
const mockPrismaQuestionFindMany = jest.fn();
const mockPrismaQuestionCreate = jest.fn();
const mockPrismaDailyQuestionFindUnique = jest.fn();
const mockPrismaDailyQuestionFindMany = jest.fn();
const mockPrismaDailyQuestionCreate = jest.fn();
const mockPrismaDailyQuestionUpdate = jest.fn();
const mockPrismaAnswerFindFirst = jest.fn();
const mockPrismaAnswerFindMany = jest.fn();
const mockPrismaAnswerCount = jest.fn();
const mockPrismaUserFindMany = jest.fn();
const mockPrismaTransaction = jest.fn();

jest.mock('../../utils/prisma', () => ({
  __esModule: true,
  default: {
    user: {
      findUnique: mockPrismaUserFindUnique,
      findMany: mockPrismaUserFindMany,
    },
    familyMembership: {
      findUnique: mockPrismaFamilyMembershipFindUnique,
      findMany: mockPrismaFamilyMembershipFindMany,
      update: mockPrismaFamilyMembershipUpdate,
      updateMany: mockPrismaFamilyMembershipUpdateMany,
    },
    question: {
      findUnique: mockPrismaQuestionFindUnique,
      findMany: mockPrismaQuestionFindMany,
      create: mockPrismaQuestionCreate,
    },
    dailyQuestion: {
      findUnique: mockPrismaDailyQuestionFindUnique,
      findMany: mockPrismaDailyQuestionFindMany,
      create: mockPrismaDailyQuestionCreate,
      update: mockPrismaDailyQuestionUpdate,
    },
    answer: {
      findFirst: mockPrismaAnswerFindFirst,
      findMany: mockPrismaAnswerFindMany,
      count: mockPrismaAnswerCount,
    },
    $transaction: mockPrismaTransaction,
  },
}));

import { QuestionService } from '../QuestionService';

const service = new QuestionService();

const mockUser = {
  id: 'db-user-id',
  userId: 'kakao:123',
  familyId: 'family-id',
};

const mockMembership = {
  userId: 'db-user-id',
  familyId: 'family-id',
  hearts: 5,
  skippedDate: null,
};

const mockQuestion = {
  id: 'question-id',
  content: '오늘 기분은 어때?',
  category: 'DAILY',
  createdAt: new Date(),
  isActive: true,
  isCustom: false,
};

const mockDailyQuestion = {
  id: 'daily-q-id',
  date: new Date('2026-01-01T00:00:00.000Z'),
  familyId: 'family-id',
  questionId: 'question-id',
  isSkipped: false,
  skippedAt: null,
  question: mockQuestion,
};

// toDailyQuestionResponse 내부에서 사용하는 추가 mock 설정
beforeEach(() => {
  mockPrismaTransaction.mockImplementation(async (arg: unknown) => {
    if (typeof arg === 'function') {
      const txProxy = {
        familyMembership: { update: mockPrismaFamilyMembershipUpdate, updateMany: mockPrismaFamilyMembershipUpdateMany },
        question: { create: mockPrismaQuestionCreate },
        dailyQuestion: { update: mockPrismaDailyQuestionUpdate },
      };
      return (arg as (tx: unknown) => Promise<unknown>)(txProxy);
    }
    return Promise.all(arg as Promise<unknown>[]);
  });
});

describe('QuestionService.getTodayQuestion', () => {
  it('존재하지 않는 유저는 에러를 던진다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue(null);
    await expect(service.getTodayQuestion('unknown')).rejects.toThrow();
  });

  it('가족에 속하지 않은 유저는 에러를 던진다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue({ ...mockUser, familyId: null });
    await expect(service.getTodayQuestion('kakao:123')).rejects.toThrow('가족에 속해 있지 않습니다.');
  });

  it('오늘 질문이 이미 있으면 새로 배정하지 않는다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaDailyQuestionFindUnique.mockResolvedValue(mockDailyQuestion);
    setupToDailyQuestionResponseMocks();

    await service.getTodayQuestion('kakao:123');
    expect(mockPrismaDailyQuestionCreate).not.toHaveBeenCalled();
  });

  it('오늘 질문이 없으면 새로 배정한다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaDailyQuestionFindUnique.mockResolvedValue(null); // 오늘 질문 없음
    // assignQuestionToFamily 내부 mock
    mockPrismaDailyQuestionFindMany.mockResolvedValue([]); // 최근 사용된 질문 없음
    mockPrismaQuestionFindMany.mockResolvedValue([mockQuestion]); // 질문 풀
    mockPrismaDailyQuestionCreate.mockResolvedValue(mockDailyQuestion);
    setupToDailyQuestionResponseMocks();

    await service.getTodayQuestion('kakao:123');
    expect(mockPrismaDailyQuestionCreate).toHaveBeenCalled();
  });
});

describe('QuestionService.skipTodayQuestion', () => {
  it('존재하지 않는 유저는 에러를 던진다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue(null);
    await expect(service.skipTodayQuestion('unknown')).rejects.toThrow();
  });

  it('가족에 속하지 않은 유저는 에러를 던진다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue({ ...mockUser, familyId: null });
    await expect(service.skipTodayQuestion('kakao:123')).rejects.toThrow('가족에 속해 있지 않습니다.');
  });

  it('멤버십이 없으면 에러를 던진다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaFamilyMembershipFindUnique.mockResolvedValue(null);
    await expect(service.skipTodayQuestion('kakao:123')).rejects.toThrow();
  });

  it('하트가 부족하면 에러를 던진다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaFamilyMembershipFindUnique.mockResolvedValue({ ...mockMembership, hearts: 2 });
    await expect(service.skipTodayQuestion('kakao:123')).rejects.toThrow('하트가 부족합니다');
  });

  it('이미 오늘 패스한 경우 에러를 던진다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    const today = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }) + 'T00:00:00.000Z');
    mockPrismaFamilyMembershipFindUnique.mockResolvedValue({
      ...mockMembership,
      hearts: 5,
      skippedDate: today,
    });
    await expect(service.skipTodayQuestion('kakao:123')).rejects.toThrow('오늘 이미 질문을 패스했습니다');
  });

  it('이미 답변한 경우 패스할 수 없다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaFamilyMembershipFindUnique.mockResolvedValue({ ...mockMembership, hearts: 5, skippedDate: null });
    mockPrismaDailyQuestionFindUnique.mockResolvedValue(mockDailyQuestion);
    mockPrismaAnswerFindFirst.mockResolvedValue({ id: 'answer-id' }); // 이미 답변

    await expect(service.skipTodayQuestion('kakao:123')).rejects.toThrow('이미 답변한 질문은 패스할 수 없습니다.');
  });

  it('패스 성공 시 하트 3개가 차감된다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaFamilyMembershipFindUnique.mockResolvedValue({ ...mockMembership, hearts: 5, skippedDate: null });
    mockPrismaDailyQuestionFindUnique.mockResolvedValue(mockDailyQuestion);
    mockPrismaAnswerFindFirst.mockResolvedValue(null); // 미답변
    mockPrismaFamilyMembershipUpdate.mockResolvedValue({ ...mockMembership, hearts: 2 });

    const result = await service.skipTodayQuestion('kakao:123');
    expect(result.heartsRemaining).toBe(2);
    expect(mockPrismaFamilyMembershipUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ hearts: { decrement: 3 } }),
      })
    );
  });
});

describe('QuestionService.createCustomQuestion', () => {
  it('가족에 속하지 않은 유저는 에러를 던진다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue({ ...mockUser, familyId: null });
    await expect(service.createCustomQuestion('kakao:123', '새 질문')).rejects.toThrow();
  });

  it('하트가 부족하면 에러를 던진다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaFamilyMembershipFindUnique.mockResolvedValue({ ...mockMembership, hearts: 2 });
    await expect(service.createCustomQuestion('kakao:123', '새 질문')).rejects.toThrow('하트가 부족합니다');
  });

  it('오늘 질문이 없으면 에러를 던진다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaFamilyMembershipFindUnique.mockResolvedValue({ ...mockMembership, hearts: 5 });
    mockPrismaDailyQuestionFindUnique.mockResolvedValue(null);
    await expect(service.createCustomQuestion('kakao:123', '새 질문')).rejects.toThrow();
  });

  it('이미 나만의 질문이 등록된 경우 에러를 던진다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaFamilyMembershipFindUnique.mockResolvedValue({ ...mockMembership, hearts: 5 });
    mockPrismaDailyQuestionFindUnique.mockResolvedValue({
      ...mockDailyQuestion,
      question: { ...mockQuestion, isCustom: true },
    });
    await expect(service.createCustomQuestion('kakao:123', '새 질문')).rejects.toThrow('오늘 이미 나만의 질문이 등록되었습니다.');
  });

  it('이미 가족 중 누군가 답변했으면 에러를 던진다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaFamilyMembershipFindUnique.mockResolvedValue({ ...mockMembership, hearts: 5 });
    mockPrismaDailyQuestionFindUnique.mockResolvedValue(mockDailyQuestion);
    mockPrismaFamilyMembershipFindMany.mockResolvedValue([{ userId: 'db-user-id' }]);
    mockPrismaAnswerCount.mockResolvedValue(1); // 이미 답변 있음

    await expect(service.createCustomQuestion('kakao:123', '새 질문')).rejects.toThrow('이미 가족 중 누군가가 답변했습니다.');
  });

  it('빈 내용은 에러를 던진다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaFamilyMembershipFindUnique.mockResolvedValue({ ...mockMembership, hearts: 5 });
    mockPrismaDailyQuestionFindUnique.mockResolvedValue(mockDailyQuestion);
    mockPrismaFamilyMembershipFindMany.mockResolvedValue([{ userId: 'db-user-id' }]);
    mockPrismaAnswerCount.mockResolvedValue(0);

    await expect(service.createCustomQuestion('kakao:123', '   ')).rejects.toThrow('질문 내용을 입력해주세요.');
  });

  it('200자 초과 내용은 에러를 던진다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaFamilyMembershipFindUnique.mockResolvedValue({ ...mockMembership, hearts: 5 });
    mockPrismaDailyQuestionFindUnique.mockResolvedValue(mockDailyQuestion);
    mockPrismaFamilyMembershipFindMany.mockResolvedValue([{ userId: 'db-user-id' }]);
    mockPrismaAnswerCount.mockResolvedValue(0);

    const longContent = 'a'.repeat(201);
    await expect(service.createCustomQuestion('kakao:123', longContent)).rejects.toThrow('200자 이내');
  });

  it('성공 시 하트 3개가 차감된다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaFamilyMembershipFindUnique
      .mockResolvedValueOnce({ ...mockMembership, hearts: 5 }) // (1) 잔액 확인
      .mockResolvedValueOnce(mockMembership)                   // (2) toDailyQuestionResponse 내부
      .mockResolvedValueOnce({ ...mockMembership, hearts: 2 }); // (3) 차감 후 최종 조회
    mockPrismaDailyQuestionFindUnique.mockResolvedValue(mockDailyQuestion);
    mockPrismaFamilyMembershipFindMany.mockResolvedValue([{ userId: 'db-user-id' }]);
    mockPrismaAnswerCount.mockResolvedValue(0);
    mockPrismaQuestionCreate.mockResolvedValue({ ...mockQuestion, id: 'new-q', isCustom: true });
    mockPrismaFamilyMembershipUpdateMany.mockResolvedValue({});
    const newDaily = { ...mockDailyQuestion, questionId: 'new-q', question: { ...mockQuestion, id: 'new-q', isCustom: true } };
    mockPrismaDailyQuestionUpdate.mockResolvedValue(newDaily);
    setupToDailyQuestionResponseMocks();

    const result = await service.createCustomQuestion('kakao:123', '새 질문 내용');
    expect(result.heartsRemaining).toBe(2);
    expect(mockPrismaFamilyMembershipUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { hearts: { decrement: 3 } },
      })
    );
  });
});

function setupToDailyQuestionResponseMocks() {
  mockPrismaUserFindMany.mockResolvedValue([{ id: 'db-user-id' }]);
  mockPrismaFamilyMembershipFindUnique.mockResolvedValue(mockMembership);
  mockPrismaAnswerFindMany.mockResolvedValue([]);
}
