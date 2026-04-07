import prisma from '../utils/prisma';

/**
 * KST 기준 오늘을 UTC 자정 Date 로 반환.
 * (@db.Date 칼럼의 저장 컨벤션과 동일)
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
 * 해당 DailyQuestion이 "그룹 전원이 답변 또는 패스 완료" 상태가 되었는지 확인한 뒤,
 * 완료 상태라면 DailyQuestion.date 를 KST 기준 오늘로 이동(=finalize)시킨다.
 *
 * 배정일자(4/7)에 받아온 질문을 실제로는 4/9에 그룹이 다 같이 마무리하는 경우,
 * history/정렬/스케줄러 모두 "4/9에 완료됐다" 로 동작하도록 만드는 핵심 함수.
 *
 * 동작:
 *   1. DQ 가 이미 오늘 날짜이면 no-op (이미 finalize 됨)
 *   2. 그룹 멤버 전원의 답변/패스 상태 확인
 *   3. 완료 상태라면 트랜잭션으로:
 *       - DailyQuestion.date ← 오늘 (KST)
 *       - 기존 DQ.date 기준으로 패스했던 멤버들의 FamilyMembership.skippedDate 도 함께 오늘로 이동
 *         (= 완료 스냅샷과 일관성 유지 — isSameDate(skippedDate, dq.date) 가 계속 true 여야 함)
 *   4. @@unique([familyId, date]) 충돌 (동일 familyId 에 오늘자 DQ 가 이미 존재) 시 원본 유지
 *
 * 멱등성: 여러 번 호출돼도 안전 (이미 완료됐거나 이미 이동된 경우 no-op).
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

  const today = getKstToday();
  // 이미 오늘자로 finalize 된 경우 (= 당일 안에 모두 답함)
  if (isSameDate(dq.date, today)) return;

  try {
    await prisma.$transaction([
      prisma.dailyQuestion.update({
        where: { id: dq.id },
        data: { date: today },
      }),
      // 기존 DQ.date 기준으로 패스했던 멤버들의 skippedDate 도 동일하게 이동
      prisma.familyMembership.updateMany({
        where: { familyId, skippedDate: dq.date },
        data: { skippedDate: today },
      }),
    ]);
    console.log(
      `[DQ Finalize] family=${familyId} dq=${dq.id} ${dq.date.toISOString().split('T')[0]} → ${today.toISOString().split('T')[0]}`
    );
  } catch (e) {
    const code = (e as { code?: string } | null)?.code;
    if (code === 'P2002') {
      // 동일 familyId + 오늘 날짜에 이미 다른 DQ 가 존재 (희귀 동시성 케이스)
      console.warn(
        `[DQ Finalize] unique 충돌, 날짜 이동 생략: family=${familyId} dq=${dailyQuestionId} → ${today.toISOString().split('T')[0]}`
      );
      return;
    }
    throw e;
  }
}
