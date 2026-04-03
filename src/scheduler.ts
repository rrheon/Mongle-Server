import { ScheduledEvent, Context } from 'aws-lambda';
import prisma from './utils/prisma';
import { NotificationService } from './services/NotificationService';
import { PushNotificationService } from './services/PushNotificationService';

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

  for (const family of families) {
    const existing = await prisma.dailyQuestion.findUnique({
      where: { familyId_date: { familyId: family.id, date: today } },
    });
    if (existing) continue;

    // 최근 미완료 질문 확인 (48시간 이내만 블로킹, 그 이상은 자동 넘김)
    const twoDaysAgo = new Date(today);
    twoDaysAgo.setUTCDate(twoDaysAgo.getUTCDate() - 2);

    const recentDQ = await prisma.dailyQuestion.findFirst({
      where: { familyId: family.id, date: { gte: twoDaysAgo, lt: today } },
      orderBy: { date: 'desc' },
    });

    if (recentDQ) {
      const memberships = await prisma.familyMembership.findMany({
        where: { familyId: family.id },
        select: { userId: true, skippedDate: true },
      });

      const kstDayStart = new Date(recentDQ.date.getTime() - 9 * 60 * 60 * 1000);
      const kstDayEnd = new Date(recentDQ.date.getTime() + 15 * 60 * 60 * 1000);
      const answeredUserIds = new Set(
        (await prisma.answer.findMany({
          where: {
            questionId: recentDQ.questionId,
            userId: { in: memberships.map((m) => m.userId) },
            createdAt: { gte: kstDayStart, lt: kstDayEnd },
          },
          select: { userId: true },
        })).map((a) => a.userId)
      );

      const allCompleted = memberships.every(
        (m) =>
          answeredUserIds.has(m.userId) ||
          (m.skippedDate !== null && m.skippedDate.getTime() === recentDQ.date.getTime())
      );

      if (!allCompleted) {
        console.log(`[Scheduler] Skipped family ${family.id}: recent question not completed (within 48h window)`);
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

    // 가족 멤버 전원에게 새 질문 알림 발송
    const members = await prisma.user.findMany({
      where: { familyId: family.id },
      select: { id: true, apnsToken: true, fcmToken: true },
    });
    const title = '오늘의 질문이 도착했어요! 🌿';
    const body = '가족과 함께 오늘의 질문에 답변해보세요.';
    for (const member of members) {
      notificationService.createNotification(member.id, 'NEW_QUESTION', title, body, family.id).catch(() => {});
      if (member.apnsToken) pushService.sendApnsPush(member.apnsToken, title, body, 'NEW_QUESTION').catch(() => {});
      if (member.fcmToken) pushService.sendFcmPush(member.fcmToken, title, body, 'NEW_QUESTION').catch(() => {});
    }
  }

  console.log(`[Scheduler] Assigned daily questions to ${assigned} families`);
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
