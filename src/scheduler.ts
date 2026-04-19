import { ScheduledEvent, Context } from 'aws-lambda';
import prisma from './utils/prisma';
import { NotificationService } from './services/NotificationService';
import { PushNotificationService } from './services/PushNotificationService';
import { getPushMessages } from './utils/i18n/push';

const notificationService = new NotificationService();
const pushService = new PushNotificationService();

// KST 기준 오늘 날짜를 UTC 자정으로 반환
function getKstToday(): Date {
  const now = new Date();
  const kstDateStr = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
  return new Date(kstDateStr + 'T00:00:00.000Z');
}

// 모든 가족에게 오늘의 질문 배정
export async function assignDailyQuestions(): Promise<void> {
  const today = getKstToday();
  const families = await prisma.family.findMany({ select: { id: true } });
  let assigned = 0;

  // 푸시 발송 대상을 유저 단위로 모아 중복 방지 (다중 그룹 소속 유저에게 1회만 발송)
  const pushTargets = new Map<string, { apnsToken: string | null; fcmToken: string | null; locale: string | null; notifQuestion: boolean }>();
  const dbNotifTasks: Promise<unknown>[] = [];

  for (const family of families) {
    const existing = await prisma.dailyQuestion.findUnique({
      where: { familyId_date: { familyId: family.id, date: today } },
    });
    if (existing) continue;

    // MG-16: 자동교체 없음. 가장 최근 DQ가 미완료면 무한정 대기.
    // 완료된 경우에만 새 질문 발급. 48h 자동 넘김 로직 제거.
    const latestDQ = await prisma.dailyQuestion.findFirst({
      where: { familyId: family.id, date: { lt: today } },
      orderBy: { date: 'desc' },
    });

    if (latestDQ) {
      const memberships = await prisma.familyMembership.findMany({
        where: { familyId: family.id },
        select: { userId: true, skippedDate: true },
      });

      const answeredUserIds = new Set(
        (await prisma.answer.findMany({
          where: {
            questionId: latestDQ.questionId,
            userId: { in: memberships.map((m) => m.userId) },
          },
          select: { userId: true },
        })).map((a) => a.userId)
      );

      const allCompleted = memberships.every(
        (m) =>
          answeredUserIds.has(m.userId) ||
          (m.skippedDate !== null && m.skippedDate.getTime() === latestDQ.date.getTime())
      );

      if (!allCompleted) {
        console.log(
          `[Scheduler] Skipped family ${family.id}: previous question (${latestDQ.date.toISOString().split('T')[0]}) not completed`
        );
        continue;
      }
    }

    const recentDate = new Date(today);
    recentDate.setDate(recentDate.getDate() - 30);
    const usedIds = (await prisma.dailyQuestion.findMany({
      where: { familyId: family.id, date: { gte: recentDate } },
      select: { questionId: true },
    })).map(q => q.questionId);

    let pool = await prisma.question.findMany({ where: { isActive: true, id: { notIn: usedIds } } });
    if (pool.length === 0) {
      pool = await prisma.question.findMany({ where: { isActive: true } });
    }
    if (pool.length === 0) continue;

    const selected = pool[Math.floor(Math.random() * pool.length)];
    await prisma.dailyQuestion.create({ data: { questionId: selected.id, familyId: family.id, date: today } });
    assigned++;

    // 가족 멤버 전원에게 DB 알림 저장 (그룹별 기록 유지) + 푸시 대상 수집
    const members = await prisma.user.findMany({
      where: { familyId: family.id },
      select: { id: true, apnsToken: true, fcmToken: true, locale: true, notifQuestion: true },
    });
    for (const member of members) {
      const msgs = getPushMessages(member.locale);
      const title = msgs.newQuestion.title;
      const body = msgs.newQuestion.body;

      // DB 알림은 그룹별로 생성 (앱 내 알림 목록에서 그룹 구분용)
      dbNotifTasks.push(
        notificationService.createNotification(member.id, 'NEW_QUESTION', title, body, family.id).catch((e) => {
          console.warn('[Scheduler] 알림 저장 실패:', e);
        })
      );

      // 푸시 대상은 유저 단위로 1회만 수집 (중복 방지)
      if (!pushTargets.has(member.id)) {
        pushTargets.set(member.id, {
          apnsToken: member.apnsToken,
          fcmToken: member.fcmToken,
          locale: member.locale,
          notifQuestion: member.notifQuestion,
        });
      }
    }
  }

  // DB 알림 저장 (그룹별) 실행
  await Promise.all(dbNotifTasks);

  // 푸시 발송 — 유저당 1회만 (다중 그룹이어도 단일 푸시)
  const pushTasks: Promise<unknown>[] = [];
  for (const [userId, target] of pushTargets) {
    if (!target.notifQuestion) continue;
    const msgs = getPushMessages(target.locale);
    const title = msgs.newQuestion.title;
    const body = msgs.newQuestion.body;

    if (target.apnsToken) {
      pushTasks.push(
        (async () => {
          const badgeCount = await notificationService.getUnreadCount(userId);
          await pushService.sendApnsPush(target.apnsToken!, title, body, 'NEW_QUESTION', badgeCount);
        })().catch((e) => {
          console.warn('[Scheduler] APNs 푸시 실패:', e);
        })
      );
    }
    if (target.fcmToken) {
      pushTasks.push(
        pushService.sendFcmPush(target.fcmToken, title, body, 'NEW_QUESTION').catch((e) => {
          console.warn('[Scheduler] FCM 푸시 실패:', e);
        })
      );
    }
  }
  await Promise.all(pushTasks);

  console.log(`[Scheduler] Assigned daily questions to ${assigned} families, pushed to ${pushTargets.size} unique users`);
}

// EventBridge Lambda 핸들러
export const handler = async (_event: ScheduledEvent, _context: Context): Promise<void> => {
  try {
    await assignDailyQuestions();
  } catch (err) {
    console.error('[Scheduler] Failed to assign daily questions:', err);
    throw err;
  }
};
