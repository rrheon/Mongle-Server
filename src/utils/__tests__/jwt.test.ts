import {
  signToken,
  signRefreshToken,
  verifyCustomToken,
  verifyRefreshToken,
  CustomJwtPayload,
} from '../jwt';

const payload: CustomJwtPayload = {
  sub: 'kakao:12345',
  email: 'test@example.com',
};

describe('signToken / verifyCustomToken', () => {
  it('토큰을 생성하고 검증할 수 있다', () => {
    const token = signToken(payload);
    const verified = verifyCustomToken(token);
    expect(verified.sub).toBe(payload.sub);
    expect(verified.email).toBe(payload.email);
  });

  it('생성된 토큰은 문자열이다', () => {
    const token = signToken(payload);
    expect(typeof token).toBe('string');
    expect(token.split('.').length).toBe(3); // JWT 형식: header.payload.signature
  });

  it('변조된 토큰은 검증에 실패한다', () => {
    const token = signToken(payload);
    const tampered = token.slice(0, -5) + 'XXXXX';
    expect(() => verifyCustomToken(tampered)).toThrow();
  });

  it('리프레시 토큰으로 액세스 검증을 시도하면 실패한다 (다른 시크릿)', () => {
    const refreshToken = signRefreshToken(payload);
    expect(() => verifyCustomToken(refreshToken)).toThrow();
  });
});

describe('signRefreshToken / verifyRefreshToken', () => {
  it('리프레시 토큰을 생성하고 검증할 수 있다', () => {
    const token = signRefreshToken(payload);
    const verified = verifyRefreshToken(token);
    expect(verified.sub).toBe(payload.sub);
    expect(verified.email).toBe(payload.email);
  });

  it('액세스 토큰으로 리프레시 검증을 시도하면 실패한다 (다른 시크릿)', () => {
    const accessToken = signToken(payload);
    expect(() => verifyRefreshToken(accessToken)).toThrow();
  });

  it('변조된 리프레시 토큰은 검증에 실패한다', () => {
    const token = signRefreshToken(payload);
    const tampered = token.slice(0, -5) + 'XXXXX';
    expect(() => verifyRefreshToken(tampered)).toThrow();
  });
});
