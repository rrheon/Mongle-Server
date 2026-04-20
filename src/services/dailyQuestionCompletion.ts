import prisma from '../utils/prisma';

function isSameDate(a: Date | null | undefined, b: Date | null | undefined): boolean {
  if (!a || !b) return false;
  return a.toISOString().split('T')[0] === b.toISOString().split('T')[0];
}

/**
 * 해당 DailyQuestion이 "그룹 전원이 답변 또는 패스 완료" 상태인지 확인하고 로깅한다.
 *
 * MG-16 이전: 완료 시 DQ.date 를 오늘로 이동시켜 history/스케줄러 정렬에 활용했음.
 * MG-16 이후: "전원 답변 → 다음 11시 새 질문 발행" 룰을 위해 같은 날 두 개의 DQ가
 * 필요해졌고, @@unique([familyId, date]) 충돌을 피하려면 date 가 배정일로 고정돼야 함.
 * 따라서 date 이동은 더 이상 수행하지 않는다. 완료 여부 판정은 호출 측에서 런타임으로
 * (isQuestionCompleted/스케줄러) 수행한다.
 *
 * 멱등성: 여러 번 호출돼도 안전 (DB 변경 없음).
 */
export async function tryFinalizeDailyQuestion(params: {
  familyId: string;
  dailyQuestionId: string;
}): Promise<void> {
  const { familyId, dailyQuestionId } = params;

  const dq = await prisma.dailyQuestion.findUnique({
    where: { id: dailyQuestionId },
    select: { id: true, date: true, questionId: true, familyId: true },
  });
  if (!dq || dq.familyId !== familyId) return;

  const memberships = await prisma.familyMembership.findMany({
    where: { familyId },
    select: { userId: true, skippedDate: true },
  });
  if (memberships.length === 0) return;

  const answers = await prisma.answer.findMany({
    where: {
      questionId: dq.questionId,
      userId: { in: memberships.map((m) => m.userId) },
    },
    select: { userId: true },
  });
  const answeredUserIds = new Set(answers.map((a) => a.userId));

  const allCompleted = memberships.every(
    (m) => answeredUserIds.has(m.userId) || isSameDate(m.skippedDate, dq.date)
  );
  if (!allCompleted) return;

  console.log(
    `[DQ Finalize] family=${familyId} dq=${dq.id} date=${dq.date.toISOString().split('T')[0]} 전원 완료`
  );
}
