import prisma from '../utils/prisma';
import { isSameKstDate } from '../utils/kst';

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

  // (MG-133) 이 DQ 인스턴스에 매핑된 답변만. questionId 만 보면 같은 question 이
  // 다음 달 재배정될 때 옛 답변으로 잘못 완료 처리될 수 있음.
  const answers = await prisma.answer.findMany({
    where: {
      dailyQuestionId: dq.id,
      userId: { in: memberships.map((m) => m.userId) },
    },
    select: { userId: true },
  });
  const answeredUserIds = new Set(answers.map((a) => a.userId));

  const allCompleted = memberships.every(
    (m) => answeredUserIds.has(m.userId) || isSameKstDate(m.skippedDate, dq.date)
  );
  if (!allCompleted) return;

  // CAS: completedAt: null 조건으로만 업데이트. 동시 호출 두 번 들어와도 한 번만
  // 갱신되어 history 노출일이 흔들리지 않는다 (이전엔 update 가 무조건 덮어써 두 번째
  // 호출의 now 로 바뀔 수 있었음).
  const now = new Date();
  const result = await prisma.dailyQuestion.updateMany({
    where: { id: dq.id, completedAt: null },
    data: { completedAt: now },
  });

  if (result.count === 1) {
    console.log(
      `[DQ Finalize] family=${familyId} dq=${dq.id} assigned=${dq.date.toISOString().split('T')[0]} completedAt=${now.toISOString()}`
    );
  }
}
