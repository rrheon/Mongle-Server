import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Route,
  Body,
  Path,
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
   * @summary 내 정보 조회
   */
  @Get('me')
  @Security('jwt')
  @SuccessResponse(200, '성공')
  public async getMe(@Request() req: AuthRequest): Promise<UserResponse> {
    return this.userService.getUserByUserId(req.user.userId);
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
    @Body() body: { token: string }
  ): Promise<{ ok: boolean }> {
    await this.userService.registerDeviceToken(req.user.userId, body.token);
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
