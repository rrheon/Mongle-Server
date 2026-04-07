import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import prisma from '../utils/prisma';
import { signToken, signRefreshToken, verifyRefreshToken } from '../utils/jwt';
import { Errors } from '../middleware/errorHandler';
import { LEGAL_VERSIONS } from '../utils/legalVersions';

// iOS 네이티브 Apple Sign-In → aud = App Bundle ID (예: com.yongheon.Mongle)
// Android Custom Tab Apple OAuth → aud = Services ID (예: com.mongle.app.signin)
// 환경변수 APPLE_BUNDLE_ID 에 콤마 구분으로 두 값을 모두 넣어야 함.
const APPLE_AUDIENCES = (process.env.APPLE_BUNDLE_ID || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const APPLE_ISSUER = 'https://appleid.apple.com';

async function verifyAppleIdentityToken(identityToken: string): Promise<{ sub: string; email?: string }> {
  const decoded = jwt.decode(identityToken, { complete: true }) as jwt.Jwt | null;
  if (!decoded?.header?.kid) {
    throw Errors.unauthorized('Apple identity token 형식이 올바르지 않습니다 (kid 누락).');
  }

  let key: { getPublicKey(): string };
  try {
    const client = jwksClient({ jwksUri: 'https://appleid.apple.com/auth/keys' });
    key = await client.getSigningKey(decoded.header.kid as string);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    console.error('[Apple Sign-In] JWKS 키 조회 실패:', msg);
    throw Errors.unauthorized(`Apple 공개키를 가져올 수 없습니다: ${msg}`);
  }

  const verifyOptions: jwt.VerifyOptions = {
    algorithms: ['RS256'],
    issuer: APPLE_ISSUER,
  };
  if (APPLE_AUDIENCES.length === 1) {
    verifyOptions.audience = APPLE_AUDIENCES[0];
  } else if (APPLE_AUDIENCES.length > 1) {
    verifyOptions.audience = APPLE_AUDIENCES as [string, ...string[]];
  }

  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(identityToken, key.getPublicKey(), verifyOptions) as jwt.JwtPayload;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    // 디버깅용: 토큰의 aud/iss를 로그로 남겨 audience 불일치를 빠르게 식별
    const tokenAud = (decoded.payload as jwt.JwtPayload | null)?.aud;
    const tokenIss = (decoded.payload as jwt.JwtPayload | null)?.iss;
    console.error('[Apple Sign-In] JWT 검증 실패:', msg, '| token.aud=', tokenAud, '| expected=', APPLE_AUDIENCES.length ? APPLE_AUDIENCES : '(검증 안함)', '| token.iss=', tokenIss);
    throw Errors.unauthorized(`Apple identity token 검증 실패: ${msg}`);
  }

  return { sub: payload.sub as string, email: payload.email as string | undefined };
}

async function fetchKakaoUserInfo(accessToken: string): Promise<{ id: string; email?: string; name?: string }> {
  const response = await fetch('https://kapi.kakao.com/v2/user/me', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) throw new Error(`Failed to fetch Kakao user info: ${response.status}`);
  const data = await response.json() as {
    id: number;
    kakao_account?: { email?: string; profile?: { nickname?: string } };
  };
  return {
    id: String(data.id),
    email: data.kakao_account?.email,
    name: data.kakao_account?.profile?.nickname
  };
}

const KAKAO_REST_API_KEY = process.env.KAKAO_REST_API_KEY || '';
const KAKAO_ISSUER = 'https://kauth.kakao.com';

async function verifyKakaoIdToken(idToken: string): Promise<{ sub: string; email?: string }> {
  const decoded = jwt.decode(idToken, { complete: true }) as jwt.Jwt | null;
  if (!decoded?.header?.kid) {
    throw Errors.unauthorized('Kakao identity token 형식이 올바르지 않습니다 (kid 누락).');
  }
  let key: { getPublicKey(): string };
  try {
    const client = jwksClient({ jwksUri: 'https://kauth.kakao.com/.well-known/jwks.json' });
    key = await client.getSigningKey(decoded.header.kid as string);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    console.error('[Kakao Sign-In] JWKS 키 조회 실패:', msg);
    throw Errors.unauthorized(`Kakao 공개키를 가져올 수 없습니다: ${msg}`);
  }
  const verifyOptions: jwt.VerifyOptions = {
    algorithms: ['RS256'],
    issuer: KAKAO_ISSUER,
  };
  if (KAKAO_REST_API_KEY) verifyOptions.audience = KAKAO_REST_API_KEY;
  try {
    const payload = jwt.verify(idToken, key.getPublicKey(), verifyOptions) as jwt.JwtPayload;
    return { sub: payload.sub as string, email: payload.email as string | undefined };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    console.error('[Kakao Sign-In] JWT 검증 실패:', msg);
    throw Errors.unauthorized(`Kakao identity token 검증 실패: ${msg}`);
  }
}

const GOOGLE_CLIENT_IDS = (process.env.GOOGLE_CLIENT_ID || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

async function verifyGoogleIdToken(idToken: string): Promise<{ sub: string; email?: string; name?: string }> {
  const decoded = jwt.decode(idToken, { complete: true }) as jwt.Jwt | null;
  if (!decoded?.header?.kid) {
    throw Errors.unauthorized('Google ID token 형식이 올바르지 않습니다 (kid 누락).');
  }
  let key: { getPublicKey(): string };
  try {
    const client = jwksClient({ jwksUri: 'https://www.googleapis.com/oauth2/v3/certs' });
    key = await client.getSigningKey(decoded.header.kid as string);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    console.error('[Google Sign-In] JWKS 키 조회 실패:', msg);
    throw Errors.unauthorized(`Google 공개키를 가져올 수 없습니다: ${msg}`);
  }
  const verifyOptions: jwt.VerifyOptions = {
    algorithms: ['RS256'],
    issuer: ['https://accounts.google.com', 'accounts.google.com'] as [string, string],
  };
  if (GOOGLE_CLIENT_IDS.length === 1) {
    verifyOptions.audience = GOOGLE_CLIENT_IDS[0];
  } else if (GOOGLE_CLIENT_IDS.length > 1) {
    verifyOptions.audience = GOOGLE_CLIENT_IDS as [string, ...string[]];
  }
  try {
    const payload = jwt.verify(idToken, key.getPublicKey(), verifyOptions) as jwt.JwtPayload;
    return { sub: payload.sub as string, email: payload.email as string | undefined, name: payload.name as string | undefined };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    console.error('[Google Sign-In] JWT 검증 실패:', msg);
    throw Errors.unauthorized(`Google ID token 검증 실패: ${msg}`);
  }
}

export interface SocialLoginResult {
  user: {
    id: string;
    email: string;
    name: string;
    profileImageUrl: string | null;
    role: string;
    familyId: string | null;
    createdAt: Date;
  };
  token: string;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  refresh_token: string;
  // 약관/개인정보 동의가 필요하면 true. 클라이언트는 이 값이 true 일 때
  // 동의 화면으로 라우팅하고 POST /auth/consent 로 동의 결과를 보내야 한다.
  needsConsent: boolean;
  requiredConsents: Array<'terms' | 'privacy'>;
  legalVersions: { terms: string; privacy: string };
}

export interface TokenRefreshResult {
  token: string;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  refresh_token: string;
}

export class AuthService {
  async socialLogin(provider: string, fields: Record<string, string>): Promise<SocialLoginResult> {
    let externalId: string;
    let email: string | undefined;
    let name: string | undefined;

    switch (provider) {
      case 'apple': {
        if (!fields.identity_token) {
          throw Errors.badRequest('identity_token required for Apple login');
        }
        const result = await verifyAppleIdentityToken(fields.identity_token);
        externalId = result.sub;
        email = fields.email || result.email;
        name = fields.name;
        break;
      }
      case 'kakao': {
        if (fields.id_token) {
          // id_token(OIDC JWT) 검증 — REST API 호출 없이 서버 검증 가능
          const result = await verifyKakaoIdToken(fields.id_token);
          externalId = result.sub;
          email = result.email || fields.email;
          name = fields.name;
        } else if (fields.access_token) {
          // fallback: access_token으로 카카오 API 직접 호출
          const result = await fetchKakaoUserInfo(fields.access_token);
          externalId = result.id;
          email = result.email || fields.email;
          name = result.name || fields.name;
        } else {
          throw Errors.badRequest('id_token or access_token required for Kakao login');
        }
        break;
      }
      case 'google': {
        if (!fields.id_token) {
          throw Errors.badRequest('id_token required for Google login');
        }
        const result = await verifyGoogleIdToken(fields.id_token);
        externalId = result.sub;
        email = result.email || fields.email;
        name = result.name || fields.name;
        break;
      }
      default:
        throw Errors.badRequest(`Unsupported social provider: ${provider}`);
    }

    const authId = `${provider}:${externalId}`;

    let user = await prisma.user.findUnique({ where: { userId: authId } });

    if (!user) {
      // 신규 가입: email unique 충돌 가능성을 명시적으로 처리해서 500이 아닌 409로 응답
      const fallbackEmail = email || `${externalId}@${provider}.social`;
      try {
        user = await prisma.user.create({
          data: {
            userId: authId,
            email: fallbackEmail,
            name: name || `${provider} 사용자`,
            role: 'OTHER',
          },
        });
      } catch (e) {
        // Prisma P2002: unique constraint failed (대부분 email)
        const code = (e as { code?: string } | null)?.code;
        if (code === 'P2002') {
          console.error('[Social Login] email unique 충돌:', fallbackEmail, '/', authId);
          throw Errors.conflict('이미 다른 계정에 등록된 이메일입니다.');
        }
        throw e;
      }
    }

    const jwtPayload = { sub: user.userId, email: user.email };
    const token = signToken(jwtPayload);
    const refresh_token = signRefreshToken(jwtPayload);

    const requiredConsents: Array<'terms' | 'privacy'> = [];
    if (user.termsAcceptedVersion !== LEGAL_VERSIONS.terms) requiredConsents.push('terms');
    if (user.privacyAcceptedVersion !== LEGAL_VERSIONS.privacy) requiredConsents.push('privacy');

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        profileImageUrl: user.profileImageUrl,
        role: user.role,
        familyId: user.familyId,
        createdAt: user.createdAt,
      },
      token,
      refresh_token,
      needsConsent: requiredConsents.length > 0,
      requiredConsents,
      legalVersions: { terms: LEGAL_VERSIONS.terms, privacy: LEGAL_VERSIONS.privacy },
    };
  }

  /**
   * 약관/개인정보 동의 저장.
   * 클라이언트는 동의 화면에서 사용자가 동의한 후 현재 버전을 그대로 전달한다.
   * 서버는 전달된 버전이 LEGAL_VERSIONS 와 일치하는지 검증한다 (오래된 클라이언트 방어).
   */
  async submitConsent(
    userId: string,
    payload: { termsVersion?: string; privacyVersion?: string }
  ): Promise<{ termsAcceptedVersion: string | null; privacyAcceptedVersion: string | null }> {
    const data: {
      termsAcceptedVersion?: string;
      termsAcceptedAt?: Date;
      privacyAcceptedVersion?: string;
      privacyAcceptedAt?: Date;
    } = {};
    const now = new Date();

    if (payload.termsVersion) {
      if (payload.termsVersion !== LEGAL_VERSIONS.terms) {
        throw Errors.badRequest(
          `terms 버전 불일치: 클라이언트=${payload.termsVersion}, 서버=${LEGAL_VERSIONS.terms}`
        );
      }
      data.termsAcceptedVersion = payload.termsVersion;
      data.termsAcceptedAt = now;
    }
    if (payload.privacyVersion) {
      if (payload.privacyVersion !== LEGAL_VERSIONS.privacy) {
        throw Errors.badRequest(
          `privacy 버전 불일치: 클라이언트=${payload.privacyVersion}, 서버=${LEGAL_VERSIONS.privacy}`
        );
      }
      data.privacyAcceptedVersion = payload.privacyVersion;
      data.privacyAcceptedAt = now;
    }

    if (Object.keys(data).length === 0) {
      throw Errors.badRequest('동의할 약관이 지정되지 않았습니다.');
    }

    const updated = await prisma.user.update({ where: { userId }, data });
    return {
      termsAcceptedVersion: updated.termsAcceptedVersion,
      privacyAcceptedVersion: updated.privacyAcceptedVersion,
    };
  }

  async refreshToken(refreshToken: string): Promise<TokenRefreshResult> {
    let payload: { sub: string; email: string };
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      throw Errors.unauthorized('유효하지 않거나 만료된 리프레시 토큰입니다.');
    }

    // 사용자가 여전히 존재하는지 확인
    const user = await prisma.user.findUnique({ where: { userId: payload.sub } });
    if (!user) throw Errors.notFound('사용자');

    const jwtPayload = { sub: user.userId, email: user.email };
    const token = signToken(jwtPayload);
    const newRefreshToken = signRefreshToken(jwtPayload);

    return { token, refresh_token: newRefreshToken };
  }

  async deleteAccount(userId: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { userId } });
    if (!user) return;

    // FK 제약으로 인해 관련 데이터 먼저 삭제
    await prisma.notification.deleteMany({ where: { userId: user.id } });
    await prisma.moodRecord.deleteMany({ where: { userId: user.id } });
    await prisma.userAccessLog.deleteMany({ where: { userId: user.id } });
    await prisma.answer.deleteMany({ where: { userId: user.id } });
    await prisma.familyMembership.deleteMany({ where: { userId: user.id } });

    await prisma.user.delete({ where: { userId } });
  }
}
