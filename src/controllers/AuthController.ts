import { Body, Controller, Delete, Post, Request, Route, Security, SuccessResponse, Tags } from 'tsoa';
import { AuthRequest } from '../middleware/auth';
import { AuthService, SocialLoginResult, TokenRefreshResult } from '../services/AuthService';

interface SocialLoginRequest {
  provider: 'apple' | 'kakao' | 'google';
  identity_token?: string;
  authorization_code?: string;
  access_token?: string;
  id_token?: string;
  name?: string;
  email?: string;
}

interface EmailSignupRequest {
  name: string;
  email: string;
  password: string;
}

interface EmailLoginRequest {
  email: string;
  password: string;
}

interface RefreshTokenRequest {
  refresh_token: string;
}

@Route('auth')
@Tags('Auth')
export class AuthController extends Controller {
  private authService = new AuthService();

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
   * 이메일 회원가입
   * @summary 이메일 회원가입
   */
  @Post('email/signup')
  @SuccessResponse(201, '회원가입 성공')
  public async emailSignup(@Body() body: EmailSignupRequest): Promise<SocialLoginResult> {
    this.setStatus(201);
    return this.authService.emailSignup(body.name, body.email, body.password);
  }

  /**
   * 이메일 로그인
   * @summary 이메일 로그인
   */
  @Post('email/login')
  @SuccessResponse(200, '로그인 성공')
  public async emailLogin(@Body() body: EmailLoginRequest): Promise<SocialLoginResult> {
    return this.authService.emailLogin(body.email, body.password);
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
   * 로그아웃
   * @summary 로그아웃 (클라이언트 토큰 삭제 확인용)
   */
  @Post('logout')
  @Security('jwt')
  @SuccessResponse(200, '로그아웃 성공')
  public async logout(): Promise<{ message: string }> {
    return { message: '로그아웃 되었습니다.' };
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
