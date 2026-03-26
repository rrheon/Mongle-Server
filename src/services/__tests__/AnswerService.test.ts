const mockPrismaUserFindUnique = jest.fn();
const mockPrismaQuestionFindUnique = jest.fn();
const mockPrismaAnswerFindUnique = jest.fn();
const mockPrismaAnswerCreate = jest.fn();
const mockPrismaAnswerFindMany = jest.fn();
const mockPrismaAnswerUpdate = jest.fn();
const mockPrismaAnswerDelete = jest.fn();
const mockPrismaFamilyMembershipFindMany = jest.fn();
const mockPrismaFamilyMembershipUpdateMany = jest.fn();

jest.mock('../../utils/prisma', () => ({
  __esModule: true,
  default: {
    user: {
      findUnique: mockPrismaUserFindUnique,
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
      findMany: mockPrismaFamilyMembershipFindMany,
      updateMany: mockPrismaFamilyMembershipUpdateMany,
    },
  },
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
    mockPrismaAnswerFindUnique.mockResolvedValue(mockAnswerWithUser); // 이미 답변 존재

    await expect(
      service.createAnswer('kakao:123', { questionId: 'question-id', content: '중복 답변' })
    ).rejects.toThrow('이미 이 질문에 답변했습니다.');
  });

  it('답변 성공 시 하트가 +1 증가한다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaQuestionFindUnique.mockResolvedValue(mockQuestion);
    mockPrismaAnswerFindUnique.mockResolvedValue(null); // 미답변
    mockPrismaAnswerCreate.mockResolvedValue(mockAnswerWithUser);
    mockPrismaFamilyMembershipUpdateMany.mockResolvedValue({ count: 1 });

    await service.createAnswer('kakao:123', { questionId: 'question-id', content: '답변' });

    expect(mockPrismaFamilyMembershipUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { hearts: { increment: 1 } },
      })
    );
  });

  it('가족이 없는 유저는 하트 업데이트를 하지 않는다', async () => {
    const userNoFamily = { ...mockUser, familyId: null };
    mockPrismaUserFindUnique.mockResolvedValue(userNoFamily);
    mockPrismaQuestionFindUnique.mockResolvedValue(mockQuestion);
    mockPrismaAnswerFindUnique.mockResolvedValue(null);
    mockPrismaAnswerCreate.mockResolvedValue(mockAnswerWithUser);

    await service.createAnswer('kakao:123', { questionId: 'question-id', content: '답변' });

    expect(mockPrismaFamilyMembershipUpdateMany).not.toHaveBeenCalled();
  });

  it('questionId는 소문자로 정규화된다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaQuestionFindUnique.mockResolvedValue(mockQuestion);
    mockPrismaAnswerFindUnique.mockResolvedValue(null);
    mockPrismaAnswerCreate.mockResolvedValue(mockAnswerWithUser);
    mockPrismaFamilyMembershipUpdateMany.mockResolvedValue({ count: 1 });

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
      { userId: 'db-user-id', nickname: '아빠', user: { name: '테스트' } },
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
      { userId: 'db-user-id', nickname: '우리아빠', user: { name: '테스트' } },
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
