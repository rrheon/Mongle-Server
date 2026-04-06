import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import prisma from '../utils/prisma';
import { signToken, signRefreshToken, verifyRefreshToken } from '../utils/jwt';
import { Errors } from '../middleware/errorHandler';

async function verifyAppleIdentityToken(identityToken: string): Promise<{ sub: string; email?: string }> {
  const client = jwksClient({ jwksUri: 'https://appleid.apple.com/auth/keys' });
  const decoded = jwt.decode(identityToken, { complete: true }) as jwt.Jwt | null;
  if (!decoded?.header?.kid) throw new Error('Invalid Apple identity token');
  const key = await client.getSigningKey(decoded.header.kid as string);
  const payload = jwt.verify(identityToken, key.getPublicKey(), { algorithms: ['RS256'] }) as jwt.JwtPayload;
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

async function verifyKakaoIdToken(idToken: string): Promise<{ sub: string; email?: string }> {
  const client = jwksClient({ jwksUri: 'https://kauth.kakao.com/.well-known/jwks.json' });
  const decoded = jwt.decode(idToken, { complete: true }) as jwt.Jwt | null;
  if (!decoded?.header?.kid) throw new Error('Invalid Kakao identity token');
  const key = await client.getSigningKey(decoded.header.kid as string);
  const payload = jwt.verify(idToken, key.getPublicKey(), { algorithms: ['RS256'] }) as jwt.JwtPayload;
  return { sub: payload.sub as string, email: payload.email as string | undefined };
}

async function verifyGoogleIdToken(idToken: string): Promise<{ sub: string; email?: string; name?: string }> {
  const client = jwksClient({ jwksUri: 'https://www.googleapis.com/oauth2/v3/certs' });
  const decoded = jwt.decode(idToken, { complete: true }) as jwt.Jwt | null;
  if (!decoded?.header?.kid) throw new Error('Invalid Google ID token');
  const key = await client.getSigningKey(decoded.header.kid as string);
  const payload = jwt.verify(idToken, key.getPublicKey(), { algorithms: ['RS256'] }) as jwt.JwtPayload;
  return { sub: payload.sub as string, email: payload.email as string | undefined, name: payload.name as string | undefined };
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
        if (!fields.identity_token) throw new Error('identity_token required for Apple login');
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
          throw new Error('id_token or access_token required for Kakao login');
        }
        break;
      }
      case 'google': {
        if (!fields.id_token) throw new Error('id_token required for Google login');
        const result = await verifyGoogleIdToken(fields.id_token);
        externalId = result.sub;
        email = result.email || fields.email;
        name = result.name || fields.name;
        break;
      }
      default:
        throw new Error(`Unsupported social provider: ${provider}`);
    }

    const authId = `${provider}:${externalId}`;

    let user = await prisma.user.findUnique({ where: { userId: authId } });

    if (!user) {
      user = await prisma.user.create({
        data: {
          userId: authId,
          email: email || `${externalId}@${provider}.social`,
          name: name || `${provider} 사용자`,
          role: 'OTHER',
        },
      });
    }

    const jwtPayload = { sub: user.userId, email: user.email };
    const token = signToken(jwtPayload);
    const refresh_token = signRefreshToken(jwtPayload);

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
