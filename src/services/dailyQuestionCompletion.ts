import prisma from '../utils/prisma';

function isSameDate(a: Date | null | undefined, b: Date | null | undefined): boolean {
  if (!a || !b) return false;
  return a.toISOString().split('T')[0] === b.toISOString().split('T')[0];
}

/**
 * 해당 DailyQuestion이 "그룹 전원이 답변 또는 패스 완료" 상태인지 확인하고
 * 완료 시각(completedAt)을 기록한다.
 *
 * 히스토리 노출일 정책:
 *   - DQ.date 는 배정일로 고정 (unique 제약: @@unique([familyId, date]))
 *   - DQ.completedAt 는 "그룹 전원 완료" 순간 기록 (nullable)
 *   - 히스토리 UI 는 completedAt ?? date 로 노출일 결정
 *   예) 20일 배정 → 21일 마지막 답변 → completedAt=21일 → 히스토리는 21일
 *
 * 멱등성:
 *   - completedAt 이 이미 설정된 경우 덮어쓰지 않음
 *   - 전원 완료 상태가 아니면 아무 것도 하지 않음
 */
export async function tryFinalizeDailyQuestion(params: {
  familyId: string;
  dailyQuestionId: string;
}): Promise<void> {
  const { familyId, dailyQuestionId } = params;

  const dq = await prisma.dailyQuestion.findUnique({
    where: { id: dailyQuestionId },
    select: { id: true, date: true, questionId: true, familyId: true, completedAt: true },
  });
  if (!dq || dq.familyId !== familyId) return;
  if (dq.completedAt) return; // 이미 완료 처리됨

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

  const now = new Date();
  await prisma.dailyQuestion.update({
    where: { id: dq.id },
    data: { completedAt: now },
  });

  console.log(
    `[DQ Finalize] family=${familyId} dq=${dq.id} assigned=${dq.date.toISOString().split('T')[0]} completedAt=${now.toISOString()}`
  );
}
