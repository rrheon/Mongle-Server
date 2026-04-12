const mockGenerateInviteCode = jest.fn().mockReturnValue('MOCKCODE');
const mockIsValidInviteCode = jest.fn().mockReturnValue(true);

const mockPrismaUserFindUnique = jest.fn();
const mockPrismaUserUpdate = jest.fn();
const mockPrismaFamilyFindUnique = jest.fn();
const mockPrismaFamilyCreate = jest.fn();
const mockPrismaFamilyDelete = jest.fn();
const mockPrismaFamilyMembershipFindUnique = jest.fn();
const mockPrismaFamilyMembershipFindMany = jest.fn();
const mockPrismaFamilyMembershipFindFirst = jest.fn();
const mockPrismaFamilyMembershipCreate = jest.fn();
const mockPrismaFamilyMembershipDeleteMany = jest.fn();
const mockPrismaFamilyMembershipCount = jest.fn();
const mockPrismaDailyQuestionDeleteMany = jest.fn();
const mockPrismaTransaction = jest.fn();

jest.mock('../../utils/prisma', () => ({
  __esModule: true,
  default: {
    user: {
      findUnique: mockPrismaUserFindUnique,
      update: mockPrismaUserUpdate,
    },
    family: {
      findUnique: mockPrismaFamilyFindUnique,
      create: mockPrismaFamilyCreate,
      delete: mockPrismaFamilyDelete,
    },
    familyMembership: {
      findUnique: mockPrismaFamilyMembershipFindUnique,
      findMany: mockPrismaFamilyMembershipFindMany,
      findFirst: mockPrismaFamilyMembershipFindFirst,
      create: mockPrismaFamilyMembershipCreate,
      deleteMany: mockPrismaFamilyMembershipDeleteMany,
      count: mockPrismaFamilyMembershipCount,
    },
    dailyQuestion: {
      deleteMany: mockPrismaDailyQuestionDeleteMany,
    },
    $transaction: mockPrismaTransaction,
  },
}));

jest.mock('../../utils/inviteCode', () => ({
  generateInviteCode: mockGenerateInviteCode,
  isValidInviteCode: mockIsValidInviteCode,
}));

import { FamilyService } from '../FamilyService';

const service = new FamilyService();

const mockUser = {
  id: 'db-user-id',
  userId: 'kakao:123',
  email: 'user@test.com',
  name: '테스트',
  profileImageUrl: null,
  role: 'OTHER',
  familyId: null,
  family: null,
  createdAt: new Date(),
};

const mockFamily = {
  id: 'family-id',
  name: '우리 가족',
  inviteCode: 'MOCKCODE',
  createdById: 'db-user-id',
  createdAt: new Date(Date.now() - 73 * 60 * 60 * 1000), // 73시간 전 (72시간/3일 체크 통과)
  memberships: [],
};

// $transaction: 콜백형과 배열형 모두 지원
beforeEach(() => {
  mockPrismaTransaction.mockImplementation(async (arg: unknown) => {
    if (typeof arg === 'function') {
      // 콜백형 트랜잭션: prisma 자체를 tx로 전달
      const txProxy = {
        family: { create: mockPrismaFamilyCreate, delete: mockPrismaFamilyDelete },
        familyMembership: {
          create: mockPrismaFamilyMembershipCreate,
          deleteMany: mockPrismaFamilyMembershipDeleteMany,
          findFirst: mockPrismaFamilyMembershipFindFirst,
        },
        user: { update: mockPrismaUserUpdate },
        dailyQuestion: { deleteMany: mockPrismaDailyQuestionDeleteMany },
      };
      return (arg as (tx: unknown) => Promise<unknown>)(txProxy);
    }
    return Promise.all(arg as Promise<unknown>[]);
  });
});

describe('FamilyService.createFamily', () => {
  it('존재하지 않는 유저는 에러를 던진다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue(null);
    await expect(
      service.createFamily('unknown', { name: '테스트', creatorRole: 'FATHER' })
    ).rejects.toThrow();
  });

  it('이미 3개 그룹에 참여 중이면 에러를 던진다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaFamilyMembershipCount.mockResolvedValue(3);

    await expect(
      service.createFamily('kakao:123', { name: '네 번째', creatorRole: 'MOTHER' })
    ).rejects.toThrow('그룹은 최대 3개까지 참여할 수 있습니다.');
  });

  it('초대코드 중복이 없으면 가족을 생성한다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaFamilyMembershipCount.mockResolvedValue(0);
    // 첫 번째 시도에서 중복 없음
    mockPrismaFamilyFindUnique.mockResolvedValueOnce(null); // inviteCode 중복 체크
    mockPrismaFamilyCreate.mockResolvedValue(mockFamily);
    mockPrismaFamilyMembershipCreate.mockResolvedValue({});
    mockPrismaUserUpdate.mockResolvedValue({});
    // getFamilyWithMembers 호출
    mockPrismaFamilyFindUnique.mockResolvedValue({ ...mockFamily, memberships: [] });

    const result = await service.createFamily('kakao:123', {
      name: '우리 가족',
      creatorRole: 'FATHER',
      nickname: '아빠',
      colorId: 'calm',
    });

    expect(result.name).toBe('우리 가족');
    expect(result.inviteCode).toBe('MOCKCODE');
  });
});

describe('FamilyService.joinFamily', () => {
  it('유효하지 않은 초대코드는 에러를 던진다', async () => {
    mockIsValidInviteCode.mockReturnValueOnce(false);
    await expect(
      service.joinFamily('kakao:123', { inviteCode: 'INVALID!', role: 'OTHER' })
    ).rejects.toThrow('유효하지 않은 초대 코드입니다.');
  });

  it('3개 그룹 한도 초과 시 에러를 던진다', async () => {
    mockIsValidInviteCode.mockReturnValue(true);
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaFamilyMembershipCount.mockResolvedValue(3);

    await expect(
      service.joinFamily('kakao:123', { inviteCode: 'ABCDEFGH', role: 'OTHER' })
    ).rejects.toThrow('그룹은 최대 3개까지 참여할 수 있습니다.');
  });

  it('존재하지 않는 초대코드는 에러를 던진다', async () => {
    mockIsValidInviteCode.mockReturnValue(true);
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaFamilyMembershipCount.mockResolvedValue(0);
    mockPrismaFamilyFindUnique.mockResolvedValue(null); // 가족 없음

    await expect(
      service.joinFamily('kakao:123', { inviteCode: 'ABCDEFGH', role: 'OTHER' })
    ).rejects.toThrow();
  });

  it('이미 가입된 그룹이면 에러를 던진다', async () => {
    mockIsValidInviteCode.mockReturnValue(true);
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaFamilyMembershipCount.mockResolvedValue(1);
    mockPrismaFamilyFindUnique.mockResolvedValue(mockFamily);
    // 이미 멤버십 존재
    mockPrismaFamilyMembershipFindUnique.mockResolvedValue({ userId: mockUser.id, familyId: mockFamily.id });

    await expect(
      service.joinFamily('kakao:123', { inviteCode: 'MOCKCODE', role: 'OTHER' })
    ).rejects.toThrow('이미 해당 그룹에 속해 있습니다.');
  });
});

describe('FamilyService.leaveFamily', () => {
  const mockUserWithFamily = { ...mockUser, familyId: 'family-id', family: mockFamily };

  it('존재하지 않는 유저는 에러를 던진다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue(null);
    await expect(service.leaveFamily('unknown')).rejects.toThrow();
  });

  it('가족에 속해 있지 않으면 에러를 던진다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue({ ...mockUser, familyId: null });
    await expect(service.leaveFamily('kakao:123')).rejects.toThrow('가족에 속해 있지 않습니다.');
  });

  it('방장이고 다른 멤버가 있으면 에러를 던진다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue({
      ...mockUserWithFamily,
      id: 'db-user-id',
    });
    mockPrismaFamilyFindUnique.mockResolvedValue({ ...mockFamily, createdById: 'db-user-id' });
    mockPrismaFamilyMembershipCount.mockResolvedValue(2); // 2명

    await expect(service.leaveFamily('kakao:123')).rejects.toThrow('가족 생성자는 가족을 떠날 수 없습니다.');
  });

  it('방장이고 혼자이면 가족이 삭제된다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue({
      ...mockUserWithFamily,
      id: 'db-user-id',
    });
    mockPrismaFamilyFindUnique.mockResolvedValue({ ...mockFamily, createdById: 'db-user-id' });
    mockPrismaFamilyMembershipCount.mockResolvedValue(1); // 혼자
    mockPrismaFamilyMembershipDeleteMany.mockResolvedValue({ count: 1 });
    mockPrismaDailyQuestionDeleteMany.mockResolvedValue({ count: 0 });
    mockPrismaFamilyDelete.mockResolvedValue({});
    mockPrismaUserUpdate.mockResolvedValue({});

    await service.leaveFamily('kakao:123');
    expect(mockPrismaFamilyDelete).toHaveBeenCalled();
  });

  it('일반 멤버 탈퇴 시 멤버십만 삭제된다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue({
      ...mockUserWithFamily,
      id: 'db-user-id',
    });
    mockPrismaFamilyFindUnique.mockResolvedValue({ ...mockFamily, createdById: 'other-user' }); // 방장 아님
    mockPrismaFamilyMembershipDeleteMany.mockResolvedValue({ count: 1 });
    mockPrismaFamilyMembershipFindFirst.mockResolvedValue(null); // 다른 가족 없음
    mockPrismaUserUpdate.mockResolvedValue({});

    await service.leaveFamily('kakao:123');
    expect(mockPrismaFamilyDelete).not.toHaveBeenCalled(); // 가족 삭제 안 함
    expect(mockPrismaFamilyMembershipDeleteMany).toHaveBeenCalled();
  });
});
