import rateLimit from 'express-rate-limit';

/**
 * 인증 관련 엔드포인트용 rate limiter
 *
 * ⚠️ 주의: Lambda 환경에서는 인메모리 스토어가 인스턴스 간에 공유되지 않습니다.
 * 운영 환경에서는 Redis(Upstash/ElastiCache) 또는 DynamoDB 기반 store로 교체 권장.
 * 그래도 단일 인스턴스 내에서는 어느 정도 brute-force를 완화합니다.
 */

// 소셜 로그인: IP당 15분에 30회
export const socialLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: '너무 많은 로그인 시도가 있었습니다. 잠시 후 다시 시도해주세요.' },
});

// 토큰 갱신: IP당 5분에 20회
export const refreshTokenLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: '토큰 갱신 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
});
