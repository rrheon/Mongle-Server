import { NotificationType, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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

  async getNotifications(authUserId: string, limit = 50): Promise<NotificationDTO[]> {
    // authUserId는 JWT의 OAuth userId (예: "kakao:xxx"), Notification.userId는 User.id(UUID) FK
    const user = await prisma.user.findUnique({ where: { userId: authUserId } });
    if (!user) return [];
    const items = await prisma.notification.findMany({
      where: { userId: user.id },
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

  async markAllAsRead(authUserId: string): Promise<{ count: number }> {
    const user = await prisma.user.findUnique({ where: { userId: authUserId } });
    if (!user) return { count: 0 };
    const result = await prisma.notification.updateMany({
      where: { userId: user.id, isRead: false },
      data: { isRead: true },
    });
    return { count: result.count };
  }

  async deleteNotification(authUserId: string, notificationId: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { userId: authUserId } });
    if (!user) throw new Error('사용자를 찾을 수 없습니다.');
    await prisma.notification.deleteMany({ where: { id: notificationId.toLowerCase(), userId: user.id } });
  }

  async deleteAllNotifications(authUserId: string): Promise<{ count: number }> {
    const user = await prisma.user.findUnique({ where: { userId: authUserId } });
    if (!user) return { count: 0 };
    const result = await prisma.notification.deleteMany({ where: { userId: user.id } });
    return { count: result.count };
  }

  /** 내부적으로 알림 생성 (다른 서비스에서 호출) */
  async createNotification(
    userId: string,
    type: NotificationType,
    title: string,
    body: string,
    familyId?: string,
    colorId?: string
  ): Promise<void> {
    await prisma.notification.create({ data: { userId, type, title, body, familyId: familyId ?? null, colorId: colorId ?? null } });
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
