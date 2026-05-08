import { NotificationType, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** unread/list 컷오프 — max(user.createdAt, now() - 14d). 가입 이전 알림과
 *  14일 이전 누적을 카운트/표시에서 제외 (MG-127). */
const UNREAD_TTL_DAYS = 14;
function computeUnreadCutoff(userCreatedAt: Date): Date {
  const ttlCutoff = new Date(Date.now() - UNREAD_TTL_DAYS * 24 * 60 * 60 * 1000);
  return userCreatedAt > ttlCutoff ? userCreatedAt : ttlCutoff;
}

export interface NotificationDTO {
  id: string;
  userId: string;
  familyId: string | null;
  type: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
  colorId: string | null;
}

export class NotificationService {

  async getNotifications(authUserId: string, limit = 50, familyId?: string): Promise<NotificationDTO[]> {
    // authUserId는 JWT의 OAuth userId (예: "kakao:xxx"), Notification.userId는 User.id(UUID) FK
    const user = await prisma.user.findUnique({ where: { userId: authUserId } });
    if (!user) return [];
    const cutoff = computeUnreadCutoff(user.createdAt);
    const items = await prisma.notification.findMany({
      where: {
        userId: user.id,
        createdAt: { gt: cutoff },
        ...(familyId ? { familyId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return items.map(this.toDTO);
  }

  async markAsRead(authUserId: string, notificationId: string): Promise<NotificationDTO> {
    const user = await prisma.user.findUnique({ where: { userId: authUserId } });
    if (!user) throw new Error('사용자를 찾을 수 없습니다.');
    const normalizedId = notificationId.toLowerCase();
    const item = await prisma.notification.updateMany({
      where: { id: normalizedId, userId: user.id },
      data: { isRead: true },
    });
    if (item.count === 0) throw new Error('알림을 찾을 수 없습니다.');
    const updated = await prisma.notification.findUniqueOrThrow({ where: { id: normalizedId } });
    return this.toDTO(updated);
  }

  async markAllAsRead(authUserId: string, familyId?: string): Promise<{ count: number }> {
    const user = await prisma.user.findUnique({ where: { userId: authUserId } });
    if (!user) return { count: 0 };
    const result = await prisma.notification.updateMany({
      where: { userId: user.id, isRead: false, ...(familyId ? { familyId } : {}) },
      data: { isRead: true },
    });
    return { count: result.count };
  }

  async deleteNotification(authUserId: string, notificationId: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { userId: authUserId } });
    if (!user) throw new Error('사용자를 찾을 수 없습니다.');
    await prisma.notification.deleteMany({ where: { id: notificationId.toLowerCase(), userId: user.id } });
  }

  async deleteAllNotifications(authUserId: string, familyId?: string): Promise<{ count: number }> {
    const user = await prisma.user.findUnique({ where: { userId: authUserId } });
    if (!user) return { count: 0 };
    const result = await prisma.notification.deleteMany({
      where: { userId: user.id, ...(familyId ? { familyId } : {}) },
    });
    return { count: result.count };
  }

  /** 내부적으로 알림 생성 (다른 서비스에서 호출). 생성된 알림 ID 를 반환해
   *  푸시 페이로드에 notificationId 로 실어 보낼 수 있도록 한다 (MG-111). */
  async createNotification(
    userId: string,
    type: NotificationType,
    title: string,
    body: string,
    familyId?: string,
    colorId?: string
  ): Promise<string> {
    const created = await prisma.notification.create({
      data: { userId, type, title, body, familyId: familyId ?? null, colorId: colorId ?? null },
    });
    return created.id;
  }

  /** 유저의 미읽음 알림 수 (뱃지 카운트용). userId 는 User.id (내부 UUID). 푸시 서비스용.
   *  user.createdAt + 14일 TTL 컷오프 적용 (MG-127). */
  async getUnreadCount(userId: string): Promise<number> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { createdAt: true },
    });
    if (!user) return 0;
    const cutoff = computeUnreadCutoff(user.createdAt);
    return prisma.notification.count({
      where: { userId, isRead: false, createdAt: { gt: cutoff } },
    });
  }

  /** 인증된 사용자의 미읽음 알림 수. iOS 가 OS 배지 동기화 시 호출 (50건 캡 우회용). */
  async getUnreadCountForAuthUser(authUserId: string): Promise<number> {
    const user = await prisma.user.findUnique({
      where: { userId: authUserId },
      select: { id: true, createdAt: true },
    });
    if (!user) return 0;
    const cutoff = computeUnreadCutoff(user.createdAt);
    return prisma.notification.count({
      where: { userId: user.id, isRead: false, createdAt: { gt: cutoff } },
    });
  }

  private toDTO(n: { id: string; userId: string; familyId: string | null; colorId?: string | null; type: NotificationType; title: string; body: string; isRead: boolean; createdAt: Date }): NotificationDTO {
    return {
      id: n.id,
      userId: n.userId,
      familyId: n.familyId,
      type: n.type,
      title: n.title,
      body: n.body,
      isRead: n.isRead,
      createdAt: n.createdAt.toISOString(),
      colorId: n.colorId ?? null,
    };
  }
}
