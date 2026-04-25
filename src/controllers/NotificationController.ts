import { Controller, Delete, Get, Patch, Path, Query, Request, Route, Security, SuccessResponse, Tags } from 'tsoa';
import { AuthRequest } from '../middleware/auth';
import { NotificationDTO, NotificationService } from '../services/NotificationService';

interface GetNotificationsResponse {
  notifications: NotificationDTO[];
}

interface MarkAllReadResponse {
  count: number;
}

interface DeleteCountResponse {
  count: number;
}

interface UnreadCountResponse {
  count: number;
}

@Route('notifications')
@Tags('Notification')
export class NotificationController extends Controller {
  private notificationService = new NotificationService();

  /**
   * 내 알림 목록 조회 (최신순)
   * @summary 알림 목록
   */
  @Get()
  @Security('jwt')
  @SuccessResponse(200, '성공')
  public async getNotifications(
    @Request() req: AuthRequest,
    @Query() limit: number = 50,
    @Query() group_id?: string
  ): Promise<GetNotificationsResponse> {
    const notifications = await this.notificationService.getNotifications(req.user.userId, limit, group_id);
    return { notifications };
  }

  /**
   * 특정 알림 읽음 처리
   * @summary 알림 읽음
   */
  @Patch('{notificationId}/read')
  @Security('jwt')
  @SuccessResponse(200, '성공')
  public async markAsRead(
    @Request() req: AuthRequest,
    @Path() notificationId: string
  ): Promise<NotificationDTO> {
    return this.notificationService.markAsRead(req.user.userId, notificationId);
  }

  /**
   * 미읽음 알림 수. OS 배지 동기화용 — iOS getNotifications(limit:50) 캡과 무관하게 정확.
   * @summary 미읽음 카운트
   */
  @Get('unread-count')
  @Security('jwt')
  @SuccessResponse(200, '성공')
  public async getUnreadCount(@Request() req: AuthRequest): Promise<UnreadCountResponse> {
    const count = await this.notificationService.getUnreadCountForAuthUser(req.user.userId);
    return { count };
  }

  /**
   * 모든 알림 읽음 처리
   * @summary 전체 읽음
   */
  @Patch('read-all')
  @Security('jwt')
  @SuccessResponse(200, '성공')
  public async markAllAsRead(
    @Request() req: AuthRequest,
    @Query() group_id?: string
  ): Promise<MarkAllReadResponse> {
    return this.notificationService.markAllAsRead(req.user.userId, group_id);
  }

  /**
   * 특정 알림 삭제
   * @summary 알림 삭제
   */
  @Delete('{notificationId}')
  @Security('jwt')
  @SuccessResponse(204, '삭제됨')
  public async deleteNotification(
    @Request() req: AuthRequest,
    @Path() notificationId: string
  ): Promise<void> {
    await this.notificationService.deleteNotification(req.user.userId, notificationId);
  }

  /**
   * 모든 알림 삭제
   * @summary 전체 알림 삭제
   */
  @Delete()
  @Security('jwt')
  @SuccessResponse(200, '삭제됨')
  public async deleteAllNotifications(
    @Request() req: AuthRequest,
    @Query() group_id?: string
  ): Promise<DeleteCountResponse> {
    return this.notificationService.deleteAllNotifications(req.user.userId, group_id);
  }
}
