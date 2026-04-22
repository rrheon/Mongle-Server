import { ScheduledEvent, Context } from 'aws-lambda';
import prisma from './utils/prisma';
import { QuestionService, notifyNewQuestion } from './services/QuestionService';

const questionService = new QuestionService();

// KST 기준 오늘 날짜를 UTC 자정으로 반환
function getKstToday(): Date {
  const now = new Date();
  const kstDateStr = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
  return new Date(kstDateStr + 'T00:00:00.000Z');
}

// 모든 가족에게 오늘의 질문 배정
//
// MG-16 적응형 스킵(전원 답변 안 된 가족은 건너뜀) 후, 적격 가족에게만
// assignQuestionToFamily 를 호출한다. 알림/푸시는 assignQuestionToFamily 내부의
// notifyNewQuestion 으로 처리되므로 스케줄러에서 별도 발송 로직을 두지 않는다.
// (QuestionService/FamilyService 경로와 알림 일관성 유지)
export async function assignDailyQuestions(): Promise<void> {
  const today = getKstToday();
  const families = await prisma.family.findMany({ select: { id: true } });
  let assigned = 0;

  for (const family of families) {
    // 한 가족의 처리가 throw 해도 다른 가족은 영향받지 않게 격리.
    try {
      const existing = await prisma.dailyQuestion.findUnique({
        where: { familyId_date: { familyId: family.id, date: today } },
      });
      if (existing) continue;

      // MG-16: 자동교체 없음. 가장 최근 DQ가 미완료면 무한정 대기.
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
          (
            await prisma.answer.findMany({
              where: {
                questionId: latestDQ.questionId,
                userId: { in: memberships.map((m) => m.userId) },
              },
              select: { userId: true },
            })
          ).map((a) => a.userId)
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

      // DQ 생성 + NEW_QUESTION 알림 + 푸시는 assignQuestionToFamily 가 한 번에 처리.
      await questionService.assignQuestionToFamily(family.id, today);
      assigned++;
    } catch (e) {
      console.error(`[Scheduler] family ${family.id} 처리 실패 — 다음 가족 계속:`, e);
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

// notifyNewQuestion 을 export (기존 임포트 호환을 위해) — 현재 이 파일 밖 호출처 없지만
// 백필 스크립트 등에서 공용으로 쓸 가능성 대비.
export { notifyNewQuestion };
