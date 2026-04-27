/**
 * 데일리 하트 grant race 시뮬레이션.
 *
 * MG-80 부터 grant 키가 (userId, familyId) 단위 FamilyMembership 으로 바뀌었다.
 * Lambda 환경처럼 connection 이 분리된 다수 클라이언트를 만들어 동시에 같은
 * 멤버십에 대해 grantDailyHeartIfNeeded 를 호출. atomic test-and-set 이 정상이면
 * hearts 는 정확히 +1 만 증가한다.
 *
 * 사용법: npx ts-node scripts/race-sim-record-access.ts
 */
import { PrismaClient } from '@prisma/client';
import { getKstToday } from '../src/utils/kst';

const TARGET_EMAIL = 'mrdydgjs@naver.com';
const CONCURRENCY = 10;

async function grantDailyHeartOnce(
  p: PrismaClient,
  userPk: string,
  familyId: string
) {
  const kstToday = getKstToday();
  await p.userAccessLog.create({ data: { userId: userPk } }).catch(() => {});
  await p.familyMembership.updateMany({
    where: {
      userId: userPk,
      familyId,
      OR: [
        { lastHeartGrantedAt: null },
        { lastHeartGrantedAt: { lt: kstToday } },
      ],
    },
    data: {
      lastHeartGrantedAt: new Date(),
      hearts: { increment: 1 },
    },
  });
}

async function main() {
  const probe = new PrismaClient();
  const user = await probe.user.findFirst({ where: { email: TARGET_EMAIL } });
  if (!user) throw new Error('user not found');
  if (!user.familyId) throw new Error('activeFamilyId is null');
  const userPk = user.id;
  const familyId = user.familyId;

  // 활성 멤버십 lastHeartGrantedAt 만 리셋 (다른 그룹은 그대로 둠)
  await probe.familyMembership.updateMany({
    where: { userId: userPk, familyId },
    data: { lastHeartGrantedAt: null },
  });
  const before = await probe.familyMembership.findUnique({
    where: { userId_familyId: { userId: userPk, familyId } },
  });
  console.log(`BEFORE: hearts=${before?.hearts}  lastHeartGrantedAt=null (membership)`);

  const clients = Array.from({ length: CONCURRENCY }, () => new PrismaClient());
  const t0 = Date.now();
  await Promise.all(clients.map((c) => grantDailyHeartOnce(c, userPk, familyId)));
  const elapsed = Date.now() - t0;

  const after = await probe.familyMembership.findUnique({
    where: { userId_familyId: { userId: userPk, familyId } },
  });

  const delta = (after?.hearts ?? 0) - (before?.hearts ?? 0);
  console.log(
    `AFTER  ${CONCURRENCY} concurrent calls (${elapsed}ms): hearts=${after?.hearts}  delta=${delta}`
  );
  console.log(`membership.lastHeartGrantedAt=${after?.lastHeartGrantedAt?.toISOString()}`);
  console.log(delta === 1 ? 'PASS — race 차단 정상' : `FAIL — delta=${delta} (expected 1)`);

  await Promise.all(clients.map((c) => c.$disconnect()));
  await probe.$disconnect();
  if (delta !== 1) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
