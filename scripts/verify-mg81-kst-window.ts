/**
 * MG-81 검증: KST 0~9시 윈도우에서 grantDailyHeartIfNeeded 가 idempotent 한지.
 *
 * 결함 재현: cutoff 가 getKstToday() (UTC 자정 표기) 였을 땐 KST 0~9시 사이
 * 두 번째 호출도 lastHeartGrantedAt < cutoff 가 TRUE 가 되어 매번 +1 발생.
 *
 * 검증 흐름:
 *   1) mrdydgjs / ㅋㅋㅋ 그룹 membership.lastHeartGrantedAt = null 로 reset
 *   2) UserService.grantDailyHeartIfNeeded 를 5회 연속 호출
 *   3) granted 결과는 [true, false, false, false, false] 여야 함
 *   4) hearts 증가량은 정확히 +1 이어야 함
 *
 * KST 09시 이후 실행해도 PASS 하지만 의미 없음 (그 시간엔 버그 미발현).
 * 가능하면 KST 00~09시 사이에 돌릴 것.
 */
import prisma from '../src/utils/prisma';
import { UserService } from '../src/services/UserService';

const TARGET_EMAIL = 'mrdydgjs@naver.com';
const TARGET_FAMILY_NAME = 'ㅋㅋㅋ';
const ITERATIONS = 5;

async function main() {
  const nowKst = new Date().toLocaleString('en-CA', { timeZone: 'Asia/Seoul' });
  const kstHour = new Date().toLocaleString('en-US', {
    timeZone: 'Asia/Seoul',
    hour: 'numeric',
    hour12: false,
  });
  console.log(`[verify-mg81] now KST = ${nowKst} (hour=${kstHour})`);
  if (Number(kstHour) >= 9) {
    console.warn('[verify-mg81] WARN: KST 09시 이후 — 결함이 발현되지 않는 시간대. PASS 해도 무의미.');
  }

  const user = await prisma.user.findFirst({ where: { email: TARGET_EMAIL } });
  if (!user) throw new Error(`user not found: ${TARGET_EMAIL}`);

  const memberships = await prisma.familyMembership.findMany({
    where: { userId: user.id },
    include: { family: { select: { name: true } } },
  });
  const target = memberships.find((m) => m.family.name === TARGET_FAMILY_NAME);
  if (!target) throw new Error(`target family not found: ${TARGET_FAMILY_NAME}`);

  const heartsBefore = target.hearts;
  console.log(`[verify-mg81] target = ${TARGET_FAMILY_NAME} (familyId=${target.familyId})`);
  console.log(`[verify-mg81] hearts before reset = ${heartsBefore}`);

  // reset: 어제 grant 받은 상태로 되돌림 (사용자에게 영향 최소)
  await prisma.familyMembership.update({
    where: { userId_familyId: { userId: user.id, familyId: target.familyId } },
    data: { lastHeartGrantedAt: null },
  });
  console.log(`[verify-mg81] lastHeartGrantedAt = null 로 reset 완료`);

  const userService = new UserService();
  const results: boolean[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const r = await userService.grantDailyHeartIfNeeded(user.id, target.familyId);
    results.push(r.granted);
  }

  const after = await prisma.familyMembership.findUnique({
    where: { userId_familyId: { userId: user.id, familyId: target.familyId } },
  });
  const heartsAfter = after?.hearts ?? -1;
  const delta = heartsAfter - heartsBefore;

  console.log(`[verify-mg81] granted results = ${JSON.stringify(results)}`);
  console.log(`[verify-mg81] hearts after = ${heartsAfter} (delta = ${delta})`);

  const grantedCount = results.filter(Boolean).length;
  const expectFirstTrueRestFalse =
    results[0] === true && results.slice(1).every((b) => b === false);
  const ok = expectFirstTrueRestFalse && delta === 1 && grantedCount === 1;

  if (!ok) {
    console.error('[verify-mg81] FAIL — idempotent 깨짐');
    process.exit(1);
  }
  console.log('[verify-mg81] PASS — 첫 호출만 grant, 이후 idempotent, hearts +1');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
