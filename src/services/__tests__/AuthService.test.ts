const mockUserFindUnique = jest.fn();
const mockUserCreate = jest.fn();
const mockSignToken = jest.fn().mockReturnValue('mock-access-token');
const mockSignRefreshToken = jest.fn().mockReturnValue('mock-refresh-token');
const mockVerifyRefreshToken = jest.fn();

jest.mock('../../utils/prisma', () => ({
  __esModule: true,
  default: {
    user: {
      findUnique: mockUserFindUnique,
      create: mockUserCreate,
    },
    notification: { deleteMany: jest.fn() },
    moodRecord: { deleteMany: jest.fn() },
    userAccessLog: { deleteMany: jest.fn() },
    answer: { deleteMany: jest.fn() },
    familyMembership: { deleteMany: jest.fn() },
  },
}));

jest.mock('../../utils/jwt', () => ({
  signToken: mockSignToken,
  signRefreshToken: mockSignRefreshToken,
  verifyRefreshToken: mockVerifyRefreshToken,
}));

// 소셜 로그인 외부 연동은 별도 통합 테스트 대상이므로 여기서는 스킵
jest.mock('jsonwebtoken', () => ({
  sign: jest.fn().mockReturnValue('mock-jwt'),
  verify: jest.fn(),
  decode: jest.fn(),
}));

jest.mock('jwks-rsa', () => jest.fn().mockReturnValue({ getSigningKey: jest.fn() }));

import { AuthService } from '../AuthService';

const service = new AuthService();

const mockDbUser = {
  id: 'db-user-id',
  userId: 'kakao:999',
  email: 'user@test.com',
  name: '테스트유저',
  profileImageUrl: null,
  role: 'OTHER',
  familyId: null,
  createdAt: new Date('2026-01-01'),
};

describe('AuthService.refreshToken', () => {
  it('유효한 리프레시 토큰으로 새 토큰을 발급한다', async () => {
    mockVerifyRefreshToken.mockReturnValue({ sub: 'kakao:999', email: 'user@test.com' });
    mockUserFindUnique.mockResolvedValue(mockDbUser);

    const result = await service.refreshToken('valid-refresh-token');
    expect(result.token).toBe('mock-access-token');
    expect(result.refresh_token).toBe('mock-refresh-token');
    expect(mockSignToken).toHaveBeenCalledWith({ sub: mockDbUser.userId, email: mockDbUser.email });
  });

  it('유효하지 않은 리프레시 토큰은 에러를 던진다', async () => {
    mockVerifyRefreshToken.mockImplementation(() => { throw new Error('jwt expired'); });
    await expect(service.refreshToken('invalid-token')).rejects.toThrow(
      '유효하지 않거나 만료된 리프레시 토큰입니다.'
    );
  });

  it('토큰은 유효하나 유저가 삭제된 경우 에러를 던진다', async () => {
    mockVerifyRefreshToken.mockReturnValue({ sub: 'deleted-user', email: 'gone@test.com' });
    mockUserFindUnique.mockResolvedValue(null);

    // ApiError 가 조사 처리(을/를)를 자동 변형하므로 정확 일치 대신 핵심 토큰으로 검증
    await expect(service.refreshToken('orphan-token')).rejects.toThrow(/사용자.+찾을 수 없습니다/);
  });
});
