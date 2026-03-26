import { ScheduledEvent, Context } from 'aws-lambda';
import prisma from './utils/prisma';

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

    // 어제 질문이 있는 경우, 모든 멤버가 답변하거나 패스했는지 확인
    const yesterday = new Date(today);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yesterdayDailyQuestion = await prisma.dailyQuestion.findUnique({
      where: { familyId_date: { familyId: family.id, date: yesterday } },
    });

    if (yesterdayDailyQuestion) {
      const memberships = await prisma.familyMembership.findMany({
        where: { familyId: family.id },
        select: { userId: true, skippedDate: true },
      });

      const kstDayStart = new Date(yesterday.getTime() - 9 * 60 * 60 * 1000);
      const kstDayEnd = new Date(yesterday.getTime() + 15 * 60 * 60 * 1000);
      const answeredUserIds = new Set(
        (await prisma.answer.findMany({
          where: {
            questionId: yesterdayDailyQuestion.questionId,
            userId: { in: memberships.map((m) => m.userId) },
            createdAt: { gte: kstDayStart, lt: kstDayEnd },
          },
          select: { userId: true },
        })).map((a) => a.userId)
      );

      const allCompleted = memberships.every(
        (m) =>
          answeredUserIds.has(m.userId) ||
          (m.skippedDate !== null && m.skippedDate.getTime() === yesterday.getTime())
      );

      if (!allCompleted) {
        console.log(`[Scheduler] Skipped family ${family.id}: not all members answered or passed yesterday`);
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
