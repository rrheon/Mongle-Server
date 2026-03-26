import { Request } from 'express';
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

// Cognito 설정 (레거시 지원용)
const COGNITO_REGION = process.env.COGNITO_REGION || 'ap-northeast-2';
const COGNITO_USER_POOL_ID = process.env.COGNITO_USER_POOL_ID || '';

const cognitoClient = jwksClient({
  jwksUri: `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/${COGNITO_USER_POOL_ID}/.well-known/jwks.json`,
  cache: true,
  cacheMaxAge: 600000,
});

// 인증된 요청 타입
export interface AuthRequest extends Request {
  user: {
    userId: string;
    email: string;
  };
}

interface CognitoJwtPayload {
  sub: string;
  email: string;
  'cognito:username': string;
  token_use: 'access' | 'id';
  iat: number;
  exp: number;
}

function getCognitoSigningKey(kid: string): Promise<string> {
  return new Promise((resolve, reject) => {
    cognitoClient.getSigningKey(kid, (err, key) => {
      if (err) { reject(err); return; }
      const signingKey = key?.getPublicKey();
      if (signingKey) resolve(signingKey);
      else reject(new Error('Unable to get signing key'));
    });
  });
}

export async function verifyToken(token: string): Promise<CognitoJwtPayload> {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || typeof decoded === 'string') throw new Error('Invalid token format');
  const kid = decoded.header.kid;
  if (!kid) throw new Error('Token missing kid');
  const signingKey = await getCognitoSigningKey(kid);
  return jwt.verify(token, signingKey, { algorithms: ['RS256'] }) as CognitoJwtPayload;
}

/**
 * tsoa용 인증 함수
 */
export async function expressAuthentication(
  request: Request,
  securityName: string,
  _scopes?: string[]
): Promise<{ userId: string; email: string }> {
  if (securityName !== 'jwt') throw new Error('Unknown security name');

  const authHeader = request.headers.authorization;
  if (!authHeader) throw new Error('No authorization header');

  const [bearer, token] = authHeader.split(' ');
  if (bearer !== 'Bearer' || !token) throw new Error('Invalid authorization header format');

  const recordAccessSilently = (userId: string) => {
    import('../services/UserService').then(({ UserService }) => {
      new UserService().recordAccess(userId).catch(() => {});
    });
  };

  // 커스텀 JWT (소셜/이메일 로그인) 먼저 검증
  try {
    const { verifyCustomToken } = await import('../utils/jwt');
    const payload = verifyCustomToken(token);
    recordAccessSilently(payload.sub);
    return { userId: payload.sub, email: payload.email };
  } catch {
    // 커스텀 JWT 아님, Cognito 토큰 시도
  }

  try {
    const payload = await verifyToken(token);
    recordAccessSilently(payload.sub);
    return { userId: payload.sub, email: payload.email };
  } catch {
    throw new Error('Invalid or expired token');
  }
}
