import prisma from '../utils/prisma';
import { Errors } from '../middleware/errorHandler';
import { NotificationService } from './NotificationService';
import { PushNotificationService } from './PushNotificationService';
import { getPushMessages } from '../utils/i18n/push';

const notificationService = new NotificationService();
const pushService = new PushNotificationService();

export class NudgeService {
  /**
   * 재촉하기 — 하트 1개 차감 + 대상 유저에게 알림 (푸시 인프라 준비 전까지 DB 기록만)
   */
  async sendNudge(senderUserId: string, targetUserId: string): Promise<{ message: string; heartsRemaining: number }> {
    const sender = await prisma.user.findUnique({ where: { userId: senderUserId } });
    if (!sender) throw Errors.notFound('사용자');
    if (!sender.familyId) throw Errors.badRequest('그룹에 속해 있지 않습니다.');

    // 하트 잔액 확인 (1개 이상 필요 — FamilyMembership 기준)
    const senderMembership = await prisma.familyMembership.findUnique({
      where: { userId_familyId: { userId: sender.id, familyId: sender.familyId } },
    });
    const currentHearts = senderMembership?.hearts ?? 0;
    if (currentHearts < 1) {
      throw Errors.badRequest('하트가 부족합니다. 재촉하기에는 하트 1개가 필요합니다.');
    }

    // 대상 유저 확인 (같은 가족인지) — FamilyMembership 기준으로 확인
    // User.familyId(활성 가족)가 달라도 같은 그룹 멤버일 수 있으므로 Membership 테이블로 검색
    const targetMembership = await prisma.familyMembership.findUnique({
      where: {
        userId_familyId: {
          userId: targetUserId.toLowerCase(),
          familyId: sender.familyId,
        },
      },
      include: { user: true },
    });
    if (!targetMembership) throw Errors.notFound('대상 그룹 구성원');
    const target = targetMembership.user;

    // 자기 자신에게 재촉 불가
    if (target.userId === senderUserId) {
      throw Errors.badRequest('자기 자신에게 재촉할 수 없습니다.');
    }

    // 하트 차감 (FamilyMembership 기준)
    await prisma.familyMembership.updateMany({
      where: { userId: sender.id, familyId: sender.familyId },
      data: { hearts: { decrement: 1 } },
    });

    const updatedMembership = await prisma.familyMembership.findUnique({
      where: { userId_familyId: { userId: sender.id, familyId: sender.familyId } },
    });

    // 재촉 알림 (수신자 locale 기준 로컬라이즈)
    const senderNickname = senderMembership?.nickname ?? sender.name;
    const senderColorId = senderMembership?.colorId ?? 'loved';
    const msgs = getPushMessages(target.locale);
    const nudgeTitle = msgs.nudge.title;
    const nudgeBody = msgs.nudge.body(senderNickname);

    await notificationService.createNotification(
      target.id,
      'ANSWER_REQUEST',
      nudgeTitle,
      nudgeBody,
      sender.familyId ?? undefined,
      senderColorId
    );

    // 푸시 발송 — Lambda 환경에서는 반드시 await 해야 함.
    // 알림 선호도 체크: notifNudge가 꺼져있으면 푸시 발송 건너뜀 (DB 알림 기록은 유지)
    const pushTasks: Promise<void>[] = [];
    if (target.notifNudge) {
      if (target.apnsToken) {
        pushTasks.push(
          (async () => {
            const badgeCount = await notificationService.getUnreadCount(target.id);
            await pushService.sendApnsPush(target.apnsToken!, nudgeTitle, nudgeBody, 'ANSWER_REQUEST', badgeCount, target.apnsEnvironment);
          })().catch((e) => {
            console.warn('[Nudge] APNs 푸시 실패:', e);
          })
        );
      }
      if (target.fcmToken) {
        pushTasks.push(
          pushService.sendFcmPush(
            target.fcmToken,
            nudgeTitle,
            nudgeBody,
            'ANSWER_REQUEST'
          ).catch((e) => {
            console.warn('[Nudge] FCM 푸시 실패:', e);
          })
        );
      }
    }
    await Promise.all(pushTasks);

    return {
      message: `${target.name}에게 재촉 알림을 보냈습니다.`,
      heartsRemaining: updatedMembership?.hearts ?? 0,
    };
  }
}
