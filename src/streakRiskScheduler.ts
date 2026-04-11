import { ScheduledEvent, Context } from 'aws-lambda';
import prisma from './utils/prisma';
import { UserService } from './services/UserService';
import { NotificationService } from './services/NotificationService';
import { PushNotificationService } from './services/PushNotificationService';
import { getPushMessages } from './utils/i18n/push';

const userService = new UserService();
const notificationService = new NotificationService();
const pushService = new PushNotificationService();

/**
 * KST 기준 YYYY-MM-DD 문자열.
 */
function getKstDateStr(offsetDays = 0): string {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() + offsetDays);
  return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}

/**
 * Streak 위험 알림 발송. PRD §3.2.
 *
 * 조건 (모두 만족):
 *   1) getStreak(user) >= 2
 *   2) 오늘 KST 답변 없음
 *   3) 어제 KST 답변 있음 (유예일 사용 중)
 *   4) user 가 속한 가족의 오늘 DailyQuestion 존재
 *   5) user.streakRiskNotify == true
 *   6) 오늘 이미 STREAK_RISK 알림 받지 않음 (중복 방지)
 */
export async function sendStreakRiskNotifications(): Promise<void> {
  const todayStr = getKstDateStr(0);
  const yesterdayStr = getKstDateStr(-1);
  const todayUtc = new Date(`${todayStr}T00:00:00.000Z`);
  const tomorrowUtc = new Date(`${todayStr}T00:00:00.000Z`);
  tomorrowUtc.setUTCDate(tomorrowUtc.getUTCDate() + 1);

  // 옵트인 + 가족 소속 + 푸시 토큰 유무 불문(자연 차단)
  const candidates = await prisma.user.findMany({
    where: {
      streakRiskNotify: true,
      familyId: { not: null },
    },
    select: {
      id: true,
      userId: true,
      apnsToken: true,
      fcmToken: true,
      locale: true,
      familyId: true,
    },
  });

  let pushed = 0;
  const tasks: Promise<unknown>[] = [];

  for (const user of candidates) {
    if (!user.familyId) continue;

    // 4) 오늘의 DailyQuestion 존재 여부
    const dq = await prisma.dailyQuestion.findFirst({
      where: {
        familyId: user.familyId,
        date: { gte: todayUtc, lt: tomorrowUtc },
      },
      select: { id: true },
    });
    if (!dq) continue;

    // 6) 중복 방지 — 오늘 이미 STREAK_RISK 알림이 저장됐는가
    const existing = await prisma.notification.findFirst({
      where: {
        userId: user.id,
        type: 'STREAK_RISK',
        createdAt: { gte: todayUtc, lt: tomorrowUtc },
      },
      select: { id: true },
    });
    if (existing) continue;

    // 2·3) 오늘/어제 답변 여부 — UTC day 기준 (기존 getStreak 과 동일 도메인)
    const answerDates = await prisma.answer.findMany({
      where: {
        userId: user.id,
        createdAt: {
          gte: new Date(`${yesterdayStr}T00:00:00.000Z`),
          lt: new Date(`${todayStr}T00:00:00.000Z`),
        },
      },
      select: { id: true },
      take: 1,
    });
    const answeredYesterday = answerDates.length > 0;
    if (!answeredYesterday) continue;

    const todayAnswer = await prisma.answer.findFirst({
      where: {
        userId: user.id,
        createdAt: { gte: todayUtc, lt: tomorrowUtc },
      },
      select: { id: true },
    });
    if (todayAnswer) continue;

    // 1) streak >= 2
    const streak = await userService.getStreak(user.userId);
    if (streak < 2) continue;

    const msgs = getPushMessages(user.locale);
    const title = msgs.streakRisk.title;
    const body = msgs.streakRisk.body(streak);

    tasks.push(
      notificationService
        .createNotification(user.id, 'STREAK_RISK', title, body, user.familyId)
        .catch((e) => {
          console.warn('[StreakRisk] 알림 저장 실패:', e);
        }),
    );
    if (user.apnsToken) {
      tasks.push(
        pushService.sendApnsPush(user.apnsToken, title, body, 'STREAK_RISK').catch((e) => {
          console.warn('[StreakRisk] APNs 푸시 실패:', e);
        }),
      );
    }
    if (user.fcmToken) {
      tasks.push(
        pushService.sendFcmPush(user.fcmToken, title, body, 'STREAK_RISK').catch((e) => {
          console.warn('[StreakRisk] FCM 푸시 실패:', e);
        }),
      );
    }
    pushed++;
  }

  await Promise.all(tasks);
  console.log(`[StreakRisk] Pushed to ${pushed} users`);
}

export const handler = async (_event: ScheduledEvent, _context: Context): Promise<void> => {
  try {
    await sendStreakRiskNotifications();
  } catch (err) {
    console.error('[StreakRisk] Failed:', err);
    throw err;
  }
};
