import { BadgeCategory } from '@prisma/client';
import prisma from '../utils/prisma';
import { UserService } from './UserService';
import { NotificationService } from './NotificationService';
import { PushNotificationService } from './PushNotificationService';

const userService = new UserService();
const notificationService = new NotificationService();
const pushService = new PushNotificationService();

export interface BadgeDefinitionDTO {
  code: string;
  category: BadgeCategory;
  iconKey: string;
  thresholdNumeric: number | null;
}

export interface UserBadgeDTO {
  code: string;
  category: BadgeCategory;
  iconKey: string;
  thresholdNumeric: number | null;
  awardedAt: string;
  seenAt: string | null;
}

export class BadgeService {
  async listDefinitions(): Promise<BadgeDefinitionDTO[]> {
    const defs = await prisma.badgeDefinition.findMany({ orderBy: { code: 'asc' } });
    return defs.map((d) => ({
      code: d.code,
      category: d.category,
      iconKey: d.iconKey,
      thresholdNumeric: d.thresholdNumeric,
    }));
  }

  async listForUser(authUserId: string): Promise<UserBadgeDTO[]> {
    const user = await prisma.user.findUnique({ where: { userId: authUserId }, select: { id: true } });
    if (!user) return [];
    const rows = await prisma.userBadge.findMany({
      where: { userId: user.id },
      include: { badge: true },
      orderBy: { awardedAt: 'desc' },
    });
    return rows.map((r) => ({
      code: r.badgeCode,
      category: r.badge.category,
      iconKey: r.badge.iconKey,
      thresholdNumeric: r.badge.thresholdNumeric,
      awardedAt: r.awardedAt.toISOString(),
      seenAt: r.seenAt ? r.seenAt.toISOString() : null,
    }));
  }

  async markSeen(authUserId: string, codes: string[]): Promise<void> {
    if (codes.length === 0) return;
    const user = await prisma.user.findUnique({ where: { userId: authUserId }, select: { id: true } });
    if (!user) return;
    await prisma.userBadge.updateMany({
      where: { userId: user.id, badgeCode: { in: codes }, seenAt: null },
      data: { seenAt: new Date() },
    });
  }

  /**
   * 답변 생성 직후 호출되는 수여 훅.
   *
   * 현재 streak 과 누적 답변 수를 조회해 아직 받지 않은 배지를 모두 수여한다.
   * 수여 직후 Notification + 푸시 1회.
   *
   * @param userDbId User.id (UUID)
   * @param authUserId JWT 의 userId (streak 조회용)
   */
  async checkAndAward(userDbId: string, authUserId: string): Promise<void> {
    const [defs, owned, streak, answerCount, user] = await Promise.all([
      prisma.badgeDefinition.findMany(),
      prisma.userBadge.findMany({ where: { userId: userDbId }, select: { badgeCode: true } }),
      userService.getStreak(authUserId),
      prisma.answer.count({ where: { userId: userDbId } }),
      prisma.user.findUnique({
        where: { id: userDbId },
        select: { apnsToken: true, fcmToken: true, locale: true, badgeEarnedNotify: true, familyId: true },
      }),
    ]);

    if (!user) return;

    const ownedCodes = new Set(owned.map((o) => o.badgeCode));
    const toAward = defs.filter((d) => {
      if (ownedCodes.has(d.code)) return false;
      if (d.thresholdNumeric == null) return false;
      if (d.category === 'STREAK') return streak >= d.thresholdNumeric;
      if (d.category === 'ANSWER_COUNT') return answerCount >= d.thresholdNumeric;
      return false;
    });

    if (toAward.length === 0) return;

    for (const def of toAward) {
      try {
        await prisma.userBadge.create({
          data: { userId: userDbId, badgeCode: def.code },
        });
      } catch (e) {
        // 유니크 제약 위반 (동시성) → 다음 배지로
        continue;
      }

      // 인앱 알림(항상) + 푸시(옵트인 시). PRD §11-9.
      const { getBadgePushMessages } = await import('../utils/i18n/push');
      const msgs = getBadgePushMessages(user.locale, def.code);

      try {
        await notificationService.createNotification(
          userDbId,
          'BADGE_EARNED',
          msgs.title,
          msgs.body,
          user.familyId ?? undefined,
        );
      } catch (e) {
        console.warn('[Badge] 알림 저장 실패:', e);
      }

      if (!user.badgeEarnedNotify) continue;
      const tasks: Promise<unknown>[] = [];
      if (user.apnsToken) {
        tasks.push(
          pushService.sendApnsPush(user.apnsToken, msgs.title, msgs.body, 'BADGE_EARNED').catch((e) => {
            console.warn('[Badge] APNs 푸시 실패:', e);
          }),
        );
      }
      if (user.fcmToken) {
        tasks.push(
          pushService.sendFcmPush(user.fcmToken, msgs.title, msgs.body, 'BADGE_EARNED').catch((e) => {
            console.warn('[Badge] FCM 푸시 실패:', e);
          }),
        );
      }
      await Promise.all(tasks);
    }
  }
}
