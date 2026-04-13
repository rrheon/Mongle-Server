import { ScheduledEvent, Context } from 'aws-lambda';
import prisma from './utils/prisma';
import { NotificationService } from './services/NotificationService';
import { PushNotificationService } from './services/PushNotificationService';
import { getPushMessages } from './utils/i18n/push';

const notificationService = new NotificationService();
const pushService = new PushNotificationService();

/**
 * KST 기준 오늘을 UTC 자정 Date 로 반환.
 */
function getKstToday(): Date {
  const now = new Date();
  const kstDateStr = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
  return new Date(kstDateStr + 'T00:00:00.000Z');
}

function isSameDate(a: Date | null | undefined, b: Date | null | undefined): boolean {
  if (!a || !b) return false;
  return a.toISOString().split('T')[0] === b.toISOString().split('T')[0];
}

/**
 * 자동 재촉 알림 발송.
 *
 * 조건:
 *   - 각 가족의 "현재 활성 DailyQuestion" 중에서
 *   - 배정 이후 24시간이 지났고 (첫날 배정 직후 재촉은 부담스러우므로 제외)
 *   - 아직 답변/패스하지 않은 멤버에게만
 *   - 하루 1회 푸시
 *
 * 전원이 이미 완료된 경우는 건너뜀.
 */
export async function sendDailyReminders(): Promise<void> {
  const today = getKstToday();
  const yesterday = new Date(today);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const twoDaysAgo = new Date(today);
  twoDaysAgo.setUTCDate(twoDaysAgo.getUTCDate() - 2);

  // "배정 이후 24시간 지났지만 48시간은 안 지난" = date <= yesterday && date > twoDaysAgo
  //   즉 date 가 어제 또는 어제 이전이지만, 스케줄러가 포기할 48h 범위 안인 DQ만 대상
  //   (오늘 배정된 DQ 에 대해서는 첫날이라 재촉 안 함)
  const candidateDQs = await prisma.dailyQuestion.findMany({
    where: {
      date: { gt: twoDaysAgo, lte: yesterday },
    },
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
      if (!user || !user.familyId) continue;
      const familyIdForNotif = user.familyId;

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
  for (const [, target] of pushTargets) {
    if (!target.notifQuestion) continue;
    const msgs = getPushMessages(target.locale);
    const title = msgs.answerReminder.title;
    const body = msgs.answerReminder.body;

    if (target.apnsToken) {
      pushTasks.push(
        pushService.sendApnsPush(target.apnsToken, title, body, 'ANSWER_REQUEST').catch((e) => {
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
