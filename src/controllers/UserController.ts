import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Route,
  Body,
  Path,
  Query,
  Security,
  Request,
  Tags,
  SuccessResponse,
} from 'tsoa';
import { AuthRequest } from '../middleware/auth';
import { UserResponse, UpdateUserRequest, AdHeartRewardRequest, HeartRewardResponse } from '../models';
import { UserService } from '../services/UserService';

@Route('users')
@Tags('Users')
export class UserController extends Controller {
  private userService = new UserService();

  /**
   * 현재 로그인한 사용자 정보 조회
   *
   * grantDailyHeart=true 인 호출은 활성 그룹 데일리 하트(+1) 지급을 동기적으로
   * 시도하고 응답의 heartGrantedToday 에 결과를 실어 보낸다. iOS 의 onAppear /
   * refreshHomeData 에서만 켜고, QuestionDetail 같은 부수 hearts sync 호출은
   * 기본값(false)으로 호출해 거짓 grant 를 방지한다 (MG-80, MG-77).
   *
   * @summary 내 정보 조회
   */
  @Get('me')
  @Security('jwt')
  @SuccessResponse(200, '성공')
  public async getMe(
    @Request() req: AuthRequest,
    @Query() grantDailyHeart?: boolean
  ): Promise<UserResponse> {
    return this.userService.getUserByUserId(req.user.userId, {
      grantDailyHeart: grantDailyHeart === true,
    });
  }

  /**
   * 사용자 정보 수정
   * @summary 내 정보 수정
   */
  @Put('me')
  @Security('jwt')
  @SuccessResponse(200, '성공')
  public async updateMe(
    @Request() req: AuthRequest,
    @Body() body: UpdateUserRequest
  ): Promise<UserResponse> {
    return this.userService.updateUser(req.user.userId, body);
  }

  /**
   * 내 연속 답변 스트릭 조회
   * @summary 스트릭 조회
   */
  @Get('me/streak')
  @Security('jwt')
  @SuccessResponse(200, '성공')
  public async getMyStreak(@Request() req: AuthRequest): Promise<{ streakDays: number }> {
    const streakDays = await this.userService.getStreak(req.user.userId);
    return { streakDays };
  }

  /**
   * APNs 디바이스 토큰 등록/갱신
   * @summary 푸시 토큰 등록
   */
  @Patch('me/device-token')
  @Security('jwt')
  @SuccessResponse(200, '성공')
  public async registerDeviceToken(
    @Request() req: AuthRequest,
    @Body() body: { token: string; environment?: 'sandbox' | 'production' }
  ): Promise<{ ok: boolean }> {
    await this.userService.registerDeviceToken(req.user.userId, body.token, body.environment);
    return { ok: true };
  }

  /**
   * FCM 디바이스 토큰 등록/갱신 (Android)
   * @summary FCM 푸시 토큰 등록
   */
  @Patch('me/fcm-token')
  @Security('jwt')
  @SuccessResponse(200, '성공')
  public async registerFcmToken(
    @Request() req: AuthRequest,
    @Body() body: { token: string }
  ): Promise<{ ok: boolean }> {
    await this.userService.registerFcmToken(req.user.userId, body.token);
    return { ok: true };
  }

  /**
   * 광고 시청 보상 하트 지급
   * @summary 광고 보상 하트 지급
   */
  @Post('me/hearts/ad-reward')
  @Security('jwt')
  @SuccessResponse(200, '성공')
  public async grantAdHearts(
    @Request() req: AuthRequest,
    @Body() body: AdHeartRewardRequest
  ): Promise<HeartRewardResponse> {
    const heartsRemaining = await this.userService.grantAdHearts(req.user.userId, body.amount);
    return { heartsRemaining };
  }

  /**
   * 알림 선호도 조회
   * @summary 알림 선호도 조회
   */
  @Get('me/notification-preferences')
  @Security('jwt')
  @SuccessResponse(200, '성공')
  public async getNotificationPreferences(@Request() req: AuthRequest) {
    return this.userService.getNotificationPreferences(req.user.userId);
  }

  /**
   * 알림 선호도 수정
   * @summary 알림 선호도 수정
   */
  @Patch('me/notification-preferences')
  @Security('jwt')
  @SuccessResponse(200, '성공')
  public async updateNotificationPreferences(
    @Request() req: AuthRequest,
    @Body() body: {
      notifAnswer?: boolean;
      notifNudge?: boolean;
      notifQuestion?: boolean;
      quietHoursEnabled?: boolean;
      quietHoursStart?: string;
      quietHoursEnd?: string;
    }
  ) {
    return this.userService.updateNotificationPreferences(req.user.userId, body);
  }

  /**
   * 사용자 ID로 조회 (본인 또는 같은 가족 구성원만 가능)
   * @summary 사용자 조회
   */
  @Get('{userId}')
  @Security('jwt')
  @SuccessResponse(200, '성공')
  public async getUser(@Request() req: AuthRequest, @Path() userId: string): Promise<UserResponse> {
    return this.userService.getUserById(req.user.userId, userId);
  }
}
