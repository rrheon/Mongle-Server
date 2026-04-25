import { Request, Response, NextFunction } from 'express';
import { ValidateError } from 'tsoa';
import { ErrorResponse } from '../models';

/**
 * 커스텀 API 에러 클래스
 */
export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// 자주 사용하는 에러 팩토리
export const Errors = {
  notFound: (resource: string) =>
    new ApiError(404, 'NOT_FOUND', `${resource}을(를) 찾을 수 없습니다.`),

  unauthorized: (message = '인증이 필요합니다.') =>
    new ApiError(401, 'UNAUTHORIZED', message),

  forbidden: (message = '권한이 없습니다.') =>
    new ApiError(403, 'FORBIDDEN', message),

  badRequest: (message: string, details?: Record<string, unknown>) =>
    new ApiError(400, 'BAD_REQUEST', message, details),

  conflict: (message: string) =>
    new ApiError(409, 'CONFLICT', message),

  tooMany: (message: string, retryAfterSec?: number) =>
    new ApiError(429, 'TOO_MANY_REQUESTS', message,
      retryAfterSec != null ? { retryAfterSec } : undefined),

  internal: (message = '서버 오류가 발생했습니다.') =>
    new ApiError(500, 'INTERNAL_ERROR', message),
};

/**
 * 전역 에러 핸들러
 */
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // tsoa 유효성 검사 에러
  if (err instanceof ValidateError) {
    const response: ErrorResponse = {
      message: '입력값이 올바르지 않습니다.',
      code: 'VALIDATION_ERROR',
      details: err.fields,
    };
    res.status(422).json(response);
    return;
  }

  // 커스텀 API 에러
  if (err instanceof ApiError) {
    console.error(`[API Error] ${err.statusCode} ${err.code}: ${err.message}`);
    const response: ErrorResponse = {
      message: err.message,
      code: err.code,
      details: err.details,
    };
    res.status(err.statusCode).json(response);
    return;
  }

  // 인증 에러 (expressAuthentication에서 throw)
  if (err.message === 'No authorization header' ||
      err.message === 'Invalid authorization header format' ||
      err.message === 'Invalid or expired token') {
    const response: ErrorResponse = {
      message: err.message,
      code: 'UNAUTHORIZED',
    };
    res.status(401).json(response);
    return;
  }

  // 알 수 없는 에러
  console.error('Unhandled error:', err);

  const response: ErrorResponse = {
    message: process.env.NODE_ENV === 'dev'
      ? err.message
      : '서버 오류가 발생했습니다.',
    code: 'INTERNAL_ERROR',
  };
  res.status(500).json(response);
}

/**
 * 404 핸들러
 */
export function notFoundHandler(_req: Request, res: Response): void {
  const response: ErrorResponse = {
    message: '요청한 리소스를 찾을 수 없습니다.',
    code: 'NOT_FOUND',
  };
  res.status(404).json(response);
}
