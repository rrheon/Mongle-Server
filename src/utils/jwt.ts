import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

if (!JWT_SECRET) throw new Error('JWT_SECRET environment variable is required');
if (!JWT_REFRESH_SECRET) throw new Error('JWT_REFRESH_SECRET environment variable is required');
const JWT_EXPIRES_IN = '1h';
const JWT_REFRESH_EXPIRES_IN = '30d';

export interface CustomJwtPayload {
  sub: string;   // user_id (format: "kakao:xxx" | "google:xxx" | "apple:xxx" | "email:xxx@...")
  email: string;
}

export function signToken(payload: CustomJwtPayload): string {
  return jwt.sign(payload, JWT_SECRET!, { expiresIn: JWT_EXPIRES_IN });
}

export function signRefreshToken(payload: CustomJwtPayload): string {
  return jwt.sign(payload, JWT_REFRESH_SECRET!, { expiresIn: JWT_REFRESH_EXPIRES_IN });
}

export function verifyCustomToken(token: string): CustomJwtPayload {
  return jwt.verify(token, JWT_SECRET!) as CustomJwtPayload;
}

export function verifyRefreshToken(token: string): CustomJwtPayload {
  return jwt.verify(token, JWT_REFRESH_SECRET!) as CustomJwtPayload;
}
