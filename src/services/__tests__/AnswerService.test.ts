// ---- Prisma mock ----
const mockPrismaUserFindUnique = jest.fn();
const mockPrismaUserFindMany = jest.fn();
const mockPrismaQuestionFindUnique = jest.fn();
const mockPrismaAnswerFindUnique = jest.fn();
const mockPrismaAnswerCreate = jest.fn();
const mockPrismaAnswerFindMany = jest.fn();
const mockPrismaAnswerUpdate = jest.fn();
const mockPrismaAnswerDelete = jest.fn();
const mockPrismaFamilyMembershipFindUnique = jest.fn();
const mockPrismaFamilyMembershipFindMany = jest.fn();
const mockPrismaFamilyMembershipUpdateMany = jest.fn();
const mockPrismaDailyQuestionFindFirst = jest.fn();
// $transaction 은 ops 배열을 받아 각각을 await 하는 형태, 또는 콜백 형태를 둘 다 지원한다.
const mockPrismaTransaction = jest.fn().mockImplementation(async (arg: unknown) => {
  if (Array.isArray(arg)) return Promise.all(arg as Promise<unknown>[]);
  if (typeof arg === 'function') return (arg as (tx: unknown) => Promise<unknown>)({});
  return arg;
});

jest.mock('../../utils/prisma', () => ({
  __esModule: true,
  default: {
    $transaction: mockPrismaTransaction,
    user: {
      findUnique: mockPrismaUserFindUnique,
      findMany: mockPrismaUserFindMany,
    },
    question: {
      findUnique: mockPrismaQuestionFindUnique,
    },
    answer: {
      findUnique: mockPrismaAnswerFindUnique,
      create: mockPrismaAnswerCreate,
      findMany: mockPrismaAnswerFindMany,
      update: mockPrismaAnswerUpdate,
      delete: mockPrismaAnswerDelete,
    },
    familyMembership: {
      findUnique: mockPrismaFamilyMembershipFindUnique,
      findMany: mockPrismaFamilyMembershipFindMany,
      updateMany: mockPrismaFamilyMembershipUpdateMany,
    },
    dailyQuestion: {
      findFirst: mockPrismaDailyQuestionFindFirst,
    },
  },
}));

// ---- 외부 서비스 / helper mock ----
const mockCreateNotification = jest.fn().mockResolvedValue(undefined);
const mockGetUnreadCount = jest.fn().mockResolvedValue(0);
jest.mock('../NotificationService', () => ({
  NotificationService: jest.fn().mockImplementation(() => ({
    createNotification: mockCreateNotification,
    getUnreadCount: mockGetUnreadCount,
  })),
}));

const mockSendApnsPush = jest.fn().mockResolvedValue(undefined);
const mockSendFcmPush = jest.fn().mockResolvedValue(undefined);
jest.mock('../PushNotificationService', () => ({
  PushNotificationService: jest.fn().mockImplementation(() => ({
    sendApnsPush: mockSendApnsPush,
    sendFcmPush: mockSendFcmPush,
  })),
}));

jest.mock('../dailyQuestionCompletion', () => ({
  tryFinalizeDailyQuestion: jest.fn().mockResolvedValue(undefined),
}));

import { AnswerService } from '../AnswerService';

const service = new AnswerService();

const mockUser = {
  id: 'db-user-id',
  userId: 'kakao:123',
  email: 'user@test.com',
  name: '테스트',
  profileImageUrl: null,
  role: 'OTHER',
  familyId: 'family-id',
  hearts: 5,
  createdAt: new Date(),
};

const mockQuestion = {
  id: 'question-id',
  content: '오늘 기분은?',
  category: 'DAILY',
  createdAt: new Date(),
  isActive: true,
  isCustom: false,
};

const mockAnswerWithUser = {
  id: 'answer-id',
  content: '오늘도 좋아요',
  imageUrl: null,
  questionId: 'question-id',
  userId: 'db-user-id',
  createdAt: new Date(),
  updatedAt: new Date(),
  user: {
    id: 'db-user-id',
    email: 'user@test.com',
    name: '테스트',
    profileImageUrl: null,
    role: 'OTHER',
    familyId: 'family-id',
    hearts: 5,
    moodId: null,
    createdAt: new Date(),
  },
};

// createAnswer 가 성공 경로로 흘러갈 때 필요한 후속 호출들을 미리 세팅
function setupCreateAnswerSuccessPath() {
  // (MG-138) familyMembership.findMany 는 두 번 호출된다:
  //   1) getFamilyIds — 사용자의 소속 그룹 목록 (답변 대상 DQ 해석 기준)
  //   2) otherMemberships — 답변 그룹의 타 멤버 (빈 배열 = 알림/푸시 루프 생략)
  mockPrismaFamilyMembershipFindMany
    .mockResolvedValueOnce([{ familyId: 'family-id' }])
    .mockResolvedValueOnce([]);
  mockPrismaDailyQuestionFindFirst.mockResolvedValue({ id: 'daily-q-id', familyId: 'family-id' });
  mockPrismaFamilyMembershipFindUnique.mockResolvedValue({ nickname: null, colorId: 'loved' });
}

describe('AnswerService.createAnswer', () => {
  it('존재하지 않는 유저는 에러를 던진다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue(null);
    await expect(
      service.createAnswer('unknown', { questionId: 'question-id', content: '답변' })
    ).rejects.toThrow();
  });

  it('존재하지 않는 질문은 에러를 던진다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaQuestionFindUnique.mockResolvedValue(null);
    await expect(
      service.createAnswer('kakao:123', { questionId: 'unknown-q', content: '답변' })
    ).rejects.toThrow();
  });

  it('이미 답변한 질문에 다시 답변하면 에러를 던진다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaQuestionFindUnique.mockResolvedValue(mockQuestion);
    mockPrismaFamilyMembershipFindMany.mockResolvedValueOnce([{ familyId: 'family-id' }]); // getFamilyIds
    mockPrismaDailyQuestionFindFirst.mockResolvedValue({ id: 'daily-q-id', familyId: 'family-id' });
    mockPrismaAnswerFindUnique.mockResolvedValue(mockAnswerWithUser); // 이미 답변 존재

    await expect(
      service.createAnswer('kakao:123', { questionId: 'question-id', content: '중복 답변' })
    ).rejects.toThrow('이미 이 질문에 답변했습니다.');
  });

  it('답변 성공 시 하트가 +1 증가한다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaQuestionFindUnique.mockResolvedValue(mockQuestion);
    mockPrismaAnswerFindUnique.mockResolvedValue(null);
    mockPrismaAnswerCreate.mockResolvedValue(mockAnswerWithUser);
    mockPrismaFamilyMembershipUpdateMany.mockResolvedValue({ count: 1 });
    setupCreateAnswerSuccessPath();

    await service.createAnswer('kakao:123', { questionId: 'question-id', content: '답변' });

    expect(mockPrismaFamilyMembershipUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ hearts: { increment: 1 } }),
      })
    );
  });

  it('소속 그룹이 없는 유저는 답변이 거부된다 (MG-138 — 멤버십 기준)', async () => {
    // user.familyId 가 null 이든 아니든, 판단 기준은 FamilyMembership 집합이다.
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaQuestionFindUnique.mockResolvedValue(mockQuestion);
    mockPrismaFamilyMembershipFindMany.mockResolvedValueOnce([]); // 멤버십 0건

    await expect(
      service.createAnswer('kakao:123', { questionId: 'question-id', content: '답변' })
    ).rejects.toThrow('활성 그룹이 없습니다');
    expect(mockPrismaFamilyMembershipUpdateMany).not.toHaveBeenCalled();
  });

  it('비활성 그룹(user.familyId 와 다른 멤버십)의 질문에도 답변이 저장된다 (MG-138)', async () => {
    // user.familyId 는 'family-id' 지만, 실제 답변 대상 DQ 는 다른 소속 그룹 'other-fam' 의 것.
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaQuestionFindUnique.mockResolvedValue(mockQuestion);
    mockPrismaAnswerFindUnique.mockResolvedValue(null);
    mockPrismaAnswerCreate.mockResolvedValue(mockAnswerWithUser);
    mockPrismaFamilyMembershipUpdateMany.mockResolvedValue({ count: 1 });
    mockPrismaFamilyMembershipFindMany
      .mockResolvedValueOnce([{ familyId: 'family-id' }, { familyId: 'other-fam' }]) // getFamilyIds
      .mockResolvedValueOnce([]); // otherMemberships
    // fallback 이 사용자의 그룹들 중 최근 DQ 로 'other-fam' 을 고른 상황
    mockPrismaDailyQuestionFindFirst.mockResolvedValue({ id: 'daily-q-other', familyId: 'other-fam' });
    mockPrismaFamilyMembershipFindUnique.mockResolvedValue({ nickname: null, colorId: 'loved' });

    await service.createAnswer('kakao:123', { questionId: 'question-id', content: '답변' });

    // 답변 생성 시 그 DQ 에 연결
    expect(mockPrismaAnswerCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ dailyQuestionId: 'daily-q-other' }),
      })
    );
    // 하트는 답변이 속한 그룹(other-fam) 에 +1
    expect(mockPrismaFamilyMembershipUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ familyId: 'other-fam' }),
        data: expect.objectContaining({ hearts: { increment: 1 } }),
      })
    );
  });

  it('questionId는 소문자로 정규화된다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaQuestionFindUnique.mockResolvedValue(mockQuestion);
    mockPrismaAnswerFindUnique.mockResolvedValue(null);
    mockPrismaAnswerCreate.mockResolvedValue(mockAnswerWithUser);
    mockPrismaFamilyMembershipUpdateMany.mockResolvedValue({ count: 1 });
    setupCreateAnswerSuccessPath();

    await service.createAnswer('kakao:123', { questionId: 'QUESTION-ID-UPPER', content: '답변' });

    expect(mockPrismaQuestionFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'question-id-upper' } })
    );
  });
});

describe('AnswerService.getMyAnswer', () => {
  it('존재하지 않는 유저는 에러를 던진다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue(null);
    await expect(service.getMyAnswer('unknown', 'question-id')).rejects.toThrow();
  });

  it('답변이 없으면 null을 반환한다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaAnswerFindUnique.mockResolvedValue(null);

    const result = await service.getMyAnswer('kakao:123', 'question-id');
    expect(result).toBeNull();
  });

  it('답변이 있으면 AnswerResponse를 반환한다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaAnswerFindUnique.mockResolvedValue(mockAnswerWithUser);

    const result = await service.getMyAnswer('kakao:123', 'question-id');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('answer-id');
    expect(result!.content).toBe('오늘도 좋아요');
  });
});

describe('AnswerService.getFamilyAnswers', () => {
  it('존재하지 않는 유저는 에러를 던진다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue(null);
    await expect(service.getFamilyAnswers('unknown', 'question-id')).rejects.toThrow();
  });

  it('가족이 없는 유저는 빈 배열을 반환한다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue({ ...mockUser, familyId: null });

    const result = await service.getFamilyAnswers('kakao:123', 'question-id');
    expect(result.answers).toEqual([]);
    expect(result.totalCount).toBe(0);
    expect(result.myAnswer).toBeNull();
  });

  it('가족 멤버들의 답변 목록을 반환한다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaFamilyMembershipFindMany.mockResolvedValue([
      { userId: 'db-user-id', nickname: '아빠', colorId: 'calm', user: { name: '테스트', moodId: null } },
    ]);
    mockPrismaAnswerFindMany.mockResolvedValue([mockAnswerWithUser]);

    const result = await service.getFamilyAnswers('kakao:123', 'question-id');
    expect(result.answers).toHaveLength(1);
    expect(result.totalCount).toBe(1);
    expect(result.myAnswer).not.toBeNull();
  });

  it('닉네임이 있으면 이름 대신 닉네임을 사용한다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaFamilyMembershipFindMany.mockResolvedValue([
      { userId: 'db-user-id', nickname: '우리아빠', colorId: 'calm', user: { name: '테스트', moodId: null } },
    ]);
    mockPrismaAnswerFindMany.mockResolvedValue([mockAnswerWithUser]);

    const result = await service.getFamilyAnswers('kakao:123', 'question-id');
    expect(result.answers[0].user.name).toBe('우리아빠');
  });
});

describe('AnswerService.updateAnswer', () => {
  it('존재하지 않는 유저는 에러를 던진다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue(null);
    await expect(service.updateAnswer('unknown', 'answer-id', { content: '수정' })).rejects.toThrow();
  });

  it('존재하지 않는 답변은 에러를 던진다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaAnswerFindUnique.mockResolvedValue(null);
    await expect(service.updateAnswer('kakao:123', 'unknown-answer', { content: '수정' })).rejects.toThrow();
  });

  it('본인의 답변이 아니면 에러를 던진다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaAnswerFindUnique.mockResolvedValue({ ...mockAnswerWithUser, userId: 'other-user-id' });
    await expect(
      service.updateAnswer('kakao:123', 'answer-id', { content: '수정' })
    ).rejects.toThrow('본인의 답변만 수정할 수 있습니다.');
  });

  it('성공 시 수정된 답변을 반환한다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaAnswerFindUnique.mockResolvedValue(mockAnswerWithUser);
    const updatedAnswer = { ...mockAnswerWithUser, content: '수정된 내용' };
    mockPrismaAnswerUpdate.mockResolvedValue(updatedAnswer);

    const result = await service.updateAnswer('kakao:123', 'answer-id', { content: '수정된 내용' });
    expect(result.content).toBe('수정된 내용');
  });
});

describe('AnswerService.deleteAnswer', () => {
  it('존재하지 않는 유저는 에러를 던진다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue(null);
    await expect(service.deleteAnswer('unknown', 'answer-id')).rejects.toThrow();
  });

  it('존재하지 않는 답변은 에러를 던진다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaAnswerFindUnique.mockResolvedValue(null);
    await expect(service.deleteAnswer('kakao:123', 'unknown-answer')).rejects.toThrow();
  });

  it('본인의 답변이 아니면 에러를 던진다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaAnswerFindUnique.mockResolvedValue({ ...mockAnswerWithUser, userId: 'other-user-id' });
    await expect(service.deleteAnswer('kakao:123', 'answer-id')).rejects.toThrow('본인의 답변만 삭제할 수 있습니다.');
  });

  it('성공 시 답변이 삭제된다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaAnswerFindUnique.mockResolvedValue(mockAnswerWithUser);
    mockPrismaAnswerDelete.mockResolvedValue({});

    await service.deleteAnswer('kakao:123', 'answer-id');
    expect(mockPrismaAnswerDelete).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'answer-id' } })
    );
  });
});
