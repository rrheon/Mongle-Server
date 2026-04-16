import { ScheduledEvent, Context } from 'aws-lambda';
import prisma from './utils/prisma';
import { NotificationService } from './services/NotificationService';
import { PushNotificationService } from './services/PushNotificationService';
import { getPushMessages } from './utils/i18n/push';

const notificationService = new NotificationService();
const pushService = new PushNotificationService();

function isSameDate(a: Date | null | undefined, b: Date | null | undefined): boolean {
  if (!a || !b) return false;
  return a.toISOString().split('T')[0] === b.toISOString().split('T')[0];
}

/**
 * 자동 재촉 알림 발송 (KST 19:00 스케줄).
 *
 * 조건:
 *   - 각 가족의 "현재 활성 DailyQuestion" (가장 최근 배정분, 날짜 무관)
 *   - 아직 답변/패스하지 않은 멤버에게만
 *   - 유저당 1회 푸시 (다중 그룹 소속이어도 중복 발송 없음)
 *
 * 전원이 이미 완료된 경우는 건너뜀.
 */
export async function sendDailyReminders(): Promise<void> {
  // 각 가족의 가장 최근 DailyQuestion 1건만 추출 (날짜 구분 없음)
  const candidateDQs = await prisma.dailyQuestion.findMany({
    distinct: ['familyId'],
    orderBy: { date: 'desc' },
    select: {
      id: true,
      questionId: true,
      familyId: true,
      date: true,
    },
  });

  let remindedFamilies = 0;
  const dbNotifTasks: Promise<unknown>[] = [];
  // 푸시 발송 대상을 유저 단위로 모아 중복 방지 (다중 그룹 소속 유저에게 1회만 발송)
  const pushTargets = new Map<string, { apnsToken: string | null; fcmToken: string | null; locale: string | null; notifQuestion: boolean }>();

  for (const dq of candidateDQs) {
    // 가족 멤버 전원 조회
    const memberships = await prisma.familyMembership.findMany({
      where: { familyId: dq.familyId },
      select: {
        userId: true,
        skippedDate: true,
        user: {
          select: { id: true, apnsToken: true, fcmToken: true, familyId: true, locale: true, notifQuestion: true },
        },
      },
    });
    if (memberships.length === 0) continue;

    // 답변한 멤버 집계 (KST 윈도우 없음 — 시간 제한 없이 questionId 기준)
    const answeredUserIds = new Set(
      (await prisma.answer.findMany({
        where: {
          questionId: dq.questionId,
          userId: { in: memberships.map((m) => m.userId) },
        },
        select: { userId: true },
      })).map((a) => a.userId)
    );

    // 미완료 멤버(답변 X, 해당 DQ 에 대한 패스 X)만 추출
    const unfinishedMemberships = memberships.filter(
      (m) => !answeredUserIds.has(m.userId) && !isSameDate(m.skippedDate, dq.date)
    );

    if (unfinishedMemberships.length === 0) continue;

    for (const m of unfinishedMemberships) {
      const user = m.user;
      if (!user) continue;
      // 해당 질문이 속한 가족 그룹 ID를 사용 (user.familyId 는 기본 그룹이라 다를 수 있음)
      const familyIdForNotif = dq.familyId;

      const msgs = getPushMessages(user.locale);
      const title = msgs.answerReminder.title;
      const body = msgs.answerReminder.body;

      // DB 알림은 그룹별로 생성 (앱 내 알림 목록에서 그룹 구분용)
      dbNotifTasks.push(
        notificationService
          .createNotification(user.id, 'ANSWER_REQUEST', title, body, familyIdForNotif)
          .catch((e) => {
            console.warn('[Reminder] 알림 저장 실패:', e);
          })
      );

      // 푸시 대상은 유저 단위로 1회만 수집 (중복 방지)
      if (!pushTargets.has(user.id)) {
        pushTargets.set(user.id, {
          apnsToken: user.apnsToken,
          fcmToken: user.fcmToken,
          locale: user.locale,
          notifQuestion: user.notifQuestion,
        });
      }
    }
    remindedFamilies++;
  }

  // DB 알림 저장 (그룹별) 실행
  await Promise.all(dbNotifTasks);

  // 푸시 발송 — 유저당 1회만 (다중 그룹이어도 단일 푸시)
  const pushTasks: Promise<unknown>[] = [];
  for (const [userId, target] of pushTargets) {
    if (!target.notifQuestion) continue;
    const msgs = getPushMessages(target.locale);
    const title = msgs.answerReminder.title;
    const body = msgs.answerReminder.body;

    if (target.apnsToken) {
      pushTasks.push(
        (async () => {
          const badgeCount = await notificationService.getUnreadCount(userId);
          await pushService.sendApnsPush(target.apnsToken!, title, body, 'ANSWER_REQUEST', badgeCount);
        })().catch((e) => {
          console.warn('[Reminder] APNs 푸시 실패:', e);
        })
      );
    }
    if (target.fcmToken) {
      pushTasks.push(
        pushService.sendFcmPush(target.fcmToken, title, body, 'ANSWER_REQUEST').catch((e) => {
          console.warn('[Reminder] FCM 푸시 실패:', e);
        })
      );
    }
  }
  await Promise.all(pushTasks);

  console.log(
    `[Reminder] Reminded ${pushTargets.size} unique users across ${remindedFamilies} families`
  );
}

// EventBridge Lambda 핸들러
export const handler = async (_event: ScheduledEvent, _context: Context): Promise<void> => {
  try {
    await sendDailyReminders();
  } catch (err) {
    console.error('[Reminder] Failed to send reminders:', err);
    throw err;
  }
};
