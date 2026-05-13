import prisma from '../utils/prisma';
import { Errors } from '../middleware/errorHandler';
import { NotificationService } from './NotificationService';
import { PushNotificationService } from './PushNotificationService';
import { getPushMessages } from '../utils/i18n/push';
import { isInQuietHours } from '../utils/quietHours';

const notificationService = new NotificationService();
const pushService = new PushNotificationService();

// 동일 (sender, target) 페어 24시간 내 최대 재촉 횟수.
// 알림 폭주 방지 + 답변 완료자 재촉 차단을 위한 1차 가드.
const NUDGE_DAILY_LIMIT_PER_TARGET = 3;
const NUDGE_WINDOW_MS = 24 * 60 * 60 * 1000;

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

    // 24시간 rate limit — 동일 대상에게 본인이 보낸 NUDGE 가 N건 이상이면 거부.
    // Notification 테이블에 sender 컬럼이 없어 이번 PR 범위에서는 target 단위 누적
    // (모든 sender 합산)으로 보호. follow-up: sender_user_id 컬럼 추가 후 페어 단위.
    const recentNudges = await prisma.notification.count({
      where: {
        userId: target.id,
        type: 'ANSWER_REQUEST',
        createdAt: { gte: new Date(Date.now() - NUDGE_WINDOW_MS) },
      },
    });
    if (recentNudges >= NUDGE_DAILY_LIMIT_PER_TARGET) {
      throw Errors.tooMany(
        `해당 구성원은 24시간 내 ${NUDGE_DAILY_LIMIT_PER_TARGET}회 이상 재촉되어 더 보낼 수 없습니다.`
      );
    }

    // 답변 완료자에게 재촉 차단 — 그룹의 활성 DQ 에 대해 target 이 이미 답변/스킵 했으면 거부.
    // 현재 DQ 가 carry-over 정책에 따라 임의 배정일을 가질 수 있으므로 latest DQ 기준.
    const activeDQ = await prisma.dailyQuestion.findFirst({
      where: { familyId: sender.familyId },
      orderBy: { date: 'desc' },
      select: { id: true, questionId: true, date: true },
    });
    if (activeDQ) {
      const targetAnswered = await prisma.answer.findFirst({
        where: { userId: target.id, questionId: activeDQ.questionId },
        select: { id: true },
      });
      const targetSkipped =
        targetMembership.skippedDate != null &&
        activeDQ.date != null &&
        targetMembership.skippedDate.toISOString().split('T')[0] ===
          activeDQ.date.toISOString().split('T')[0];
      if (targetAnswered || targetSkipped) {
        throw Errors.badRequest('이미 답변/패스한 구성원에게는 재촉할 수 없습니다.');
      }
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

    // 생성된 알림 ID 를 푸시 페이로드의 notificationId 로 전달 → 클라 자동 markAsRead (MG-111)
    const nudgeNotificationId = await notificationService.createNotification(
      target.id,
      'ANSWER_REQUEST',
      nudgeTitle,
      nudgeBody,
      sender.familyId ?? undefined,
      senderColorId
    );

    // 푸시 발송 — Lambda 환경에서는 반드시 await 해야 함.
    // 알림 선호도 체크: notifNudge 꺼졌거나 quiet hours 면 푸시 발송 건너뜀 (DB 알림 기록은 유지)
    const pushTasks: Promise<void>[] = [];
    if (target.notifNudge && !isInQuietHours(target)) {
      if (target.apnsToken) {
        pushTasks.push(
          (async () => {
            const badgeCount = await notificationService.getUnreadCount(target.id);
            await pushService.sendApnsPush(target.apnsToken!, nudgeTitle, nudgeBody, 'ANSWER_REQUEST', badgeCount, target.apnsEnvironment, nudgeNotificationId);
          })().catch((e) => {
            console.warn('[Nudge] APNs 푸시 실패:', e);
          })
        );
      }
      if (target.fcmToken) {
        pushTasks.push(
          (async () => {
            const unreadCount = await notificationService.getUnreadCount(target.id);
            await pushService.sendFcmPush(
              target.fcmToken!,
              nudgeTitle,
              nudgeBody,
              'ANSWER_REQUEST',
              undefined,
              nudgeNotificationId,
              unreadCount
            );
          })().catch((e) => {
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
