/**
 * 이메일/비밀번호 기반 회원가입 및 로그인.
 *
 * 플로우 (회원가입):
 *   1) requestSignupCode(email)  → 6자리 코드 생성, code_hash 로 저장, 메일 발송
 *   2) signup(email, password, code, termsVersion, privacyVersion)
 *        → EmailVerification 검증 → User 생성 (bcrypt 해시) → SocialLoginResult 반환
 *
 * 로그인:
 *   login(email, password) → bcrypt 비교 후 토큰 발급
 *
 * 보안 노트:
 *   - code 는 생으로 저장하지 않고 bcrypt 해시 저장 (10 round)
 *   - 실패 시 attempts 증가, 5회 초과면 해당 레코드 consumed 처리
 *   - 코드 만료 10분, 재요청시 기존 미사용 레코드는 consumed 처리
 *   - 이메일 존재 여부 노출 최소화 (가입시만 명확히 409 반환)
 */

import bcrypt from 'bcryptjs';
import prisma from '../utils/prisma';
import { issueTokensForUser } from './AuthService';
import { Errors } from '../middleware/errorHandler';
import { LEGAL_VERSIONS } from '../utils/legalVersions';
import { sendVerificationEmail } from '../utils/emailSender';
import type { SocialLoginResult } from './AuthService';

const CODE_EXPIRY_MS = 10 * 60 * 1000; // 10분
const MAX_ATTEMPTS = 5;
const BCRYPT_ROUNDS = 10;
// requestSignupCode 동일 이메일 재요청 최소 간격. SMTP 비용/스팸 방지.
const CODE_REQUEST_COOLDOWN_MS = 60 * 1000;
// 로그인 brute-force 잠금 윈도우/임계값. attempts >= LOGIN_LOCK_THRESHOLD 면
// LOGIN_LOCK_WINDOW_MS 동안 잠금 (429). 잠금 동안에도 attempts 는 증가하지 않는다.
const LOGIN_LOCK_THRESHOLD = 5;
const LOGIN_LOCK_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LOCK_PURPOSE = 'LOGIN_LOCK';

// RFC 5322 간소화 버전 — 클라이언트에서도 동일 수준으로 검증
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// 10자 이상 + 특수문자 1개 이상
const PASSWORD_SPECIAL_REGEX = /[^A-Za-z0-9]/;

function validateEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!EMAIL_REGEX.test(normalized)) {
    throw Errors.badRequest('이메일 형식이 올바르지 않습니다.');
  }
  return normalized;
}

function validatePassword(password: string): void {
  if (password.length < 10) {
    throw Errors.badRequest('비밀번호는 10자 이상이어야 합니다.');
  }
  if (!PASSWORD_SPECIAL_REGEX.test(password)) {
    throw Errors.badRequest('비밀번호에는 특수문자가 1개 이상 포함되어야 합니다.');
  }
}

function generate6DigitCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export class EmailAuthService {
  /**
   * 회원가입 인증코드 발송.
   * 이미 가입된 이메일이면 409. 그 외엔 기존 미사용 레코드 무효화 후 새 코드 발급.
   */
  async requestSignupCode(rawEmail: string): Promise<{ sent: true; expiresInSec: number }> {
    const email = validateEmail(rawEmail);

    // 이미 가입된 이메일인지 확인 (소셜 포함)
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw Errors.conflict('이미 가입된 이메일입니다.');
    }

    // 60초 쿨다운 — 동일 이메일에 대한 코드 재요청 폭주/SMTP 비용 방어.
    // 잠금/스팸 방지가 목적이라 "이미 발송됨" 정도의 정보 노출은 허용.
    const recent = await prisma.emailVerification.findFirst({
      where: { email, purpose: 'SIGNUP' },
      orderBy: { createdAt: 'desc' },
    });
    if (recent && Date.now() - recent.createdAt.getTime() < CODE_REQUEST_COOLDOWN_MS) {
      const retryAfterSec = Math.ceil(
        (CODE_REQUEST_COOLDOWN_MS - (Date.now() - recent.createdAt.getTime())) / 1000
      );
      throw Errors.tooMany(`코드 재발송은 ${retryAfterSec}초 뒤에 가능합니다.`);
    }

    // 기존 발송분 consumed 처리
    await prisma.emailVerification.updateMany({
      where: { email, purpose: 'SIGNUP', consumed: false },
      data: { consumed: true },
    });

    const code = generate6DigitCode();
    const codeHash = await bcrypt.hash(code, BCRYPT_ROUNDS);
    const expiresAt = new Date(Date.now() + CODE_EXPIRY_MS);

    await prisma.emailVerification.create({
      data: { email, purpose: 'SIGNUP', codeHash, expiresAt },
    });

    try {
      await sendVerificationEmail(email, code);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown';
      console.error('[EmailAuthService] 메일 발송 실패:', msg);
      throw Errors.internal('인증 메일 발송에 실패했습니다.');
    }

    return { sent: true, expiresInSec: Math.floor(CODE_EXPIRY_MS / 1000) };
  }

  /**
   * 인증코드 검증 + 회원 생성.
   * 약관 버전은 클라이언트의 Consent 화면에서 수집 후 전달한다 (가입 전이라 JWT 없음).
   */
  async signup(params: {
    email: string;
    password: string;
    code: string;
    name?: string;
    termsVersion: string;
    privacyVersion: string;
  }): Promise<SocialLoginResult> {
    const email = validateEmail(params.email);
    validatePassword(params.password);

    // 약관 버전 검증 (오래된 클라이언트 방어)
    if (params.termsVersion !== LEGAL_VERSIONS.terms) {
      throw Errors.badRequest(
        `terms 버전 불일치: 클라이언트=${params.termsVersion}, 서버=${LEGAL_VERSIONS.terms}`
      );
    }
    if (params.privacyVersion !== LEGAL_VERSIONS.privacy) {
      throw Errors.badRequest(
        `privacy 버전 불일치: 클라이언트=${params.privacyVersion}, 서버=${LEGAL_VERSIONS.privacy}`
      );
    }

    // 중복 가입 체크 (race condition 대비)
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw Errors.conflict('이미 가입된 이메일입니다.');
    }

    // 가장 최근 미사용 SIGNUP 레코드 조회
    const record = await prisma.emailVerification.findFirst({
      where: { email, purpose: 'SIGNUP', consumed: false },
      orderBy: { createdAt: 'desc' },
    });
    if (!record) {
      throw Errors.badRequest('인증 코드를 먼저 요청해주세요.');
    }
    if (record.expiresAt.getTime() < Date.now()) {
      await prisma.emailVerification.update({ where: { id: record.id }, data: { consumed: true } });
      throw Errors.badRequest('인증 코드가 만료되었습니다. 다시 요청해주세요.');
    }
    if (record.attempts >= MAX_ATTEMPTS) {
      await prisma.emailVerification.update({ where: { id: record.id }, data: { consumed: true } });
      throw Errors.badRequest('인증 시도 횟수를 초과했습니다. 코드를 다시 요청해주세요.');
    }

    const codeMatches = await bcrypt.compare(params.code, record.codeHash);
    if (!codeMatches) {
      await prisma.emailVerification.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      throw Errors.badRequest('인증 코드가 올바르지 않습니다.');
    }

    // 코드 소진
    await prisma.emailVerification.update({
      where: { id: record.id },
      data: { consumed: true },
    });

    // 사용자 생성
    const passwordHash = await bcrypt.hash(params.password, BCRYPT_ROUNDS);
    const authId = `email:${email}`;
    const now = new Date();

    let user;
    try {
      user = await prisma.user.create({
        data: {
          userId: authId,
          email,
          name: params.name?.trim() || email.split('@')[0],
          role: 'OTHER',
          passwordHash,
          termsAcceptedVersion: params.termsVersion,
          termsAcceptedAt: now,
          privacyAcceptedVersion: params.privacyVersion,
          privacyAcceptedAt: now,
        },
      });
    } catch (e) {
      const code = (e as { code?: string } | null)?.code;
      if (code === 'P2002') {
        throw Errors.conflict('이미 가입된 이메일입니다.');
      }
      throw e;
    }

    return buildLoginResult(user);
  }

  /**
   * 기존 이메일 계정 로그인.
   * brute-force 방어: EmailVerification (purpose=LOGIN_LOCK) 을 piggyback 으로 활용해
   * 이메일 단위 실패 카운트/잠금 윈도우를 추적. 별도 스키마 마이그레이션 없이 적용.
   * 잠금 활성 동안은 비밀번호 검증 자체를 건너뛰고 429 즉시 반환.
   */
  async login(rawEmail: string, password: string): Promise<SocialLoginResult> {
    const email = validateEmail(rawEmail);
    const now = new Date();

    // 잠금 윈도우 안의 LOGIN_LOCK 레코드 조회
    const lock = await prisma.emailVerification.findFirst({
      where: { email, purpose: LOGIN_LOCK_PURPOSE, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
    });

    if (lock && lock.attempts >= LOGIN_LOCK_THRESHOLD) {
      const retryAfterSec = Math.ceil((lock.expiresAt.getTime() - now.getTime()) / 1000);
      throw Errors.tooMany(
        `로그인 시도가 너무 많습니다. ${retryAfterSec}초 뒤에 다시 시도해주세요.`,
        retryAfterSec
      );
    }

    const user = await prisma.user.findUnique({ where: { email } });
    const passwordOk = user?.passwordHash
      ? await bcrypt.compare(password, user.passwordHash)
      : false;

    if (!user || !user.passwordHash || !passwordOk) {
      // 실패 카운트 증가. lock 이 없으면 새로 만들고, 있으면 attempts 증가.
      if (lock) {
        await prisma.emailVerification.update({
          where: { id: lock.id },
          data: { attempts: { increment: 1 } },
        });
      } else {
        await prisma.emailVerification.create({
          data: {
            email,
            purpose: LOGIN_LOCK_PURPOSE,
            // 임의의 비교에 쓰이지 않는 자리. bcrypt hash 컬럼 NOT NULL 제약 충족용 placeholder.
            codeHash: '-',
            expiresAt: new Date(now.getTime() + LOGIN_LOCK_WINDOW_MS),
            attempts: 1,
          },
        });
      }
      // 소셜 전용 계정도 동일 메시지 — 이메일 존재 여부 노출 최소화
      throw Errors.unauthorized('이메일 또는 비밀번호가 올바르지 않습니다.');
    }

    // 성공: 잠금 윈도우 정리
    if (lock) {
      await prisma.emailVerification.update({
        where: { id: lock.id },
        data: { consumed: true, attempts: 0 },
      });
    }

    return buildLoginResult(user);
  }
}

type UserRow = Awaited<ReturnType<typeof prisma.user.findUnique>>;

async function buildLoginResult(user: NonNullable<UserRow>): Promise<SocialLoginResult> {
  const jwtPayload = { sub: user.userId, email: user.email };
  const { token, refresh_token } = await issueTokensForUser(user.id, jwtPayload);

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
