/**
 * (MG-133) Answer.dailyQuestionId 백필 스크립트.
 *
 * schema 적용 (`npm run db:push`) 후 실행. idempotent — 이미 채워진 행은 건드리지 않는다.
 *
 * 매핑 규칙:
 *   - 같은 questionId 의 DailyQuestion 중에서
 *   - Answer.user 가 속한 (또는 속했던) familyId 의 DQ 만 후보로
 *   - DQ.date <= Answer.createdAt 중 가장 최근 date 에 매핑
 *   → 진단 스크립트와 같은 로직. dry-run 결과: 매핑 67 / orphan 38 / 충돌 0.
 *
 * 실행:  npx ts-node scripts/backfill-answer-daily-question-id.ts          # dry-run (변경 없음)
 *        npx ts-node scripts/backfill-answer-daily-question-id.ts --apply  # 실제 UPDATE
 */

import prisma from '../src/utils/prisma';

const APPLY = process.argv.includes('--apply');

async function main() {
  console.log(`mode: ${APPLY ? 'APPLY (UPDATE 실행)' : 'DRY-RUN (변경 없음)'}\n`);

  const targets = await prisma.answer.findMany({
    where: { dailyQuestionId: null },
    select: { id: true, userId: true, questionId: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`백필 대상 (dailyQuestionId IS NULL): ${targets.length}건`);

  let mapped = 0;
  let orphan = 0;
  let updated = 0;
  let updateFailed = 0;

  // user → familyIds 캐시 (스크립트 한 번 실행 동안 변하지 않음)
  const familyIdsByUser = new Map<string, string[]>();
  async function getFamilyIds(userId: string): Promise<string[]> {
    const cached = familyIdsByUser.get(userId);
    if (cached) return cached;
    const ms = await prisma.familyMembership.findMany({
      where: { userId },
      select: { familyId: true },
    });
    const ids = ms.map((m) => m.familyId);
    familyIdsByUser.set(userId, ids);
    return ids;
  }

  for (const ans of targets) {
    const familyIds = await getFamilyIds(ans.userId);
    if (familyIds.length === 0) {
      orphan++;
      continue;
    }

    const target = await prisma.dailyQuestion.findFirst({
      where: {
        questionId: ans.questionId,
        familyId: { in: familyIds },
        date: { lte: ans.createdAt },
      },
      orderBy: { date: 'desc' },
      select: { id: true },
    });

    if (!target) {
      orphan++;
      continue;
    }

    mapped++;

    if (APPLY) {
      try {
        await prisma.answer.update({
          where: { id: ans.id },
          data: { dailyQuestionId: target.id },
        });
        updated++;
      } catch (e) {
        updateFailed++;
        console.error(`  UPDATE 실패: answer=${ans.id} dq=${target.id}`, e);
      }
    }
  }

  console.log(`\n결과:`);
  console.log(`  매핑 가능 (target DQ 발견): ${mapped}건`);
  console.log(`  매핑 불가 (orphan, NULL 유지): ${orphan}건`);
  if (APPLY) {
    console.log(`  실제 UPDATE 성공: ${updated}건`);
    console.log(`  UPDATE 실패: ${updateFailed}건`);
  } else {
    console.log(`  → --apply 플래그 추가 시 ${mapped}건 UPDATE 실행`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
