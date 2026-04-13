import { Body, Controller, Delete, Post, Request, Route, Security, SuccessResponse, Tags } from 'tsoa';
import { AuthRequest } from '../middleware/auth';
import { AuthService, SocialLoginResult, TokenRefreshResult } from '../services/AuthService';
import { EmailAuthService } from '../services/EmailAuthService';

interface SocialLoginRequest {
  provider: 'apple' | 'kakao' | 'google';
  identity_token?: string;
  authorization_code?: string;
  access_token?: string;
  id_token?: string;
  name?: string;
  email?: string;
}

interface RefreshTokenRequest {
  refresh_token: string;
}

interface ConsentRequest {
  termsVersion?: string;
  privacyVersion?: string;
}

interface ConsentResponse {
  termsAcceptedVersion: string | null;
  privacyAcceptedVersion: string | null;
}

interface EmailRequestCodeRequest {
  email: string;
}

interface EmailRequestCodeResponse {
  sent: true;
  expiresInSec: number;
}

interface EmailSignupRequest {
  email: string;
  password: string;
  code: string;
  name?: string;
  termsVersion: string;
  privacyVersion: string;
}

interface EmailLoginRequest {
  email: string;
  password: string;
}

@Route('auth')
@Tags('Auth')
export class AuthController extends Controller {
  private authService = new AuthService();
  private emailAuthService = new EmailAuthService();

  /**
   * 소셜 로그인 (Apple / Kakao / Google)
   * @summary 소셜 로그인
   */
  @Post('social')
  @SuccessResponse(200, '로그인 성공')
  public async socialLogin(@Body() body: SocialLoginRequest): Promise<SocialLoginResult> {
    const { provider, ...rest } = body;
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(rest)) {
      if (v !== undefined) fields[k] = v;
    }
    return this.authService.socialLogin(provider, fields);
  }

  /**
   * 액세스 토큰 갱신
   * @summary 토큰 갱신 (리프레시 토큰으로 새 액세스 토큰 발급)
   */
  @Post('refresh')
  @SuccessResponse(200, '토큰 갱신 성공')
  public async refreshToken(@Body() body: RefreshTokenRequest): Promise<TokenRefreshResult> {
    return this.authService.refreshToken(body.refresh_token);
  }

  /**
   * 로그아웃 — 디바이스 푸시 토큰(APNs/FCM) 제거 포함
   * @summary 로그아웃 (디바이스 토큰 정리 + 클라이언트 토큰 삭제)
   */
  @Post('logout')
  @Security('jwt')
  @SuccessResponse(200, '로그아웃 성공')
  public async logout(@Request() req: AuthRequest): Promise<{ message: string }> {
    await this.authService.logout(req.user.userId);
    return { message: '로그아웃 되었습니다.' };
  }

  /**
   * 약관/개인정보 동의 저장.
   * 클라이언트는 동의 화면에서 사용자가 동의한 후 LEGAL_VERSIONS 의 현재 버전을
   * 그대로 전달한다. 서버 버전과 일치하지 않으면 400 (오래된 클라이언트 방어).
   * @summary 약관 동의
   */
  @Post('consent')
  @Security('jwt')
  @SuccessResponse(200, '동의 저장 성공')
  public async submitConsent(
    @Request() req: AuthRequest,
    @Body() body: ConsentRequest
  ): Promise<ConsentResponse> {
    return this.authService.submitConsent(req.user.userId, body);
  }

  /**
   * 이메일 회원가입용 6자리 인증코드 발송.
   * 이미 가입된 이메일이면 409. 10분간 유효.
   * @summary 이메일 인증코드 요청
   */
  @Post('email/request-code')
  @SuccessResponse(200, '코드 발송 성공')
  public async requestEmailCode(
    @Body() body: EmailRequestCodeRequest
  ): Promise<EmailRequestCodeResponse> {
    return this.emailAuthService.requestSignupCode(body.email);
  }

  /**
   * 이메일 회원가입 완료. 인증코드 검증 후 유저 생성.
   * 약관 동의는 가입 이전 단계이므로 클라이언트가 termsVersion/privacyVersion 을 함께 전달한다.
   * @summary 이메일 회원가입
   */
  @Post('email/signup')
  @SuccessResponse(200, '회원가입 성공')
  public async emailSignup(@Body() body: EmailSignupRequest): Promise<SocialLoginResult> {
    return this.emailAuthService.signup(body);
  }

  /**
   * 이메일/비밀번호 로그인 (기존 회원)
   * @summary 이메일 로그인
   */
  @Post('email/login')
  @SuccessResponse(200, '로그인 성공')
  public async emailLogin(@Body() body: EmailLoginRequest): Promise<SocialLoginResult> {
    return this.emailAuthService.login(body.email, body.password);
  }

  /**
   * 계정 삭제
   * @summary 회원탈퇴
   */
  @Delete('account')
  @Security('jwt')
  @SuccessResponse(204, '계정 삭제 성공')
  public async deleteAccount(@Request() req: AuthRequest): Promise<void> {
    await this.authService.deleteAccount(req.user.userId);
    this.setStatus(204);
  }
}
