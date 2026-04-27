/**
 * recordAccess race 시뮬레이션.
 *
 * Lambda 환경처럼 connection 이 분리된 다수 클라이언트를 만들어
 * 동시에 같은 사용자의 recordAccess 를 호출. 핫픽스(MG-76)가
 * 정상 동작하면 hearts 는 정확히 +1 만 증가한다.
 *
 * 사용법: npx ts-node scripts/race-sim-record-access.ts
 */
import { PrismaClient } from '@prisma/client';
import { getKstToday } from '../src/utils/kst';

const TARGET_EMAIL = 'mrdydgjs@naver.com';
const CONCURRENCY = 10;

async function recordAccessOnce(p: PrismaClient, userPk: string, familyId: string | null) {
  const kstToday = getKstToday();
  await p.userAccessLog.create({ data: { userId: userPk } }).catch(() => {});
  await p.$transaction(async (tx) => {
    const result = await tx.user.updateMany({
      where: {
        id: userPk,
        OR: [
          { lastHeartGrantedAt: null },
          { lastHeartGrantedAt: { lt: kstToday } },
        ],
      },
      data: { lastHeartGrantedAt: new Date() },
    });
    if (result.count > 0 && familyId) {
      await tx.familyMembership.updateMany({
        where: { userId: userPk, familyId },
        data: { hearts: { increment: 1 } },
      });
    }
  });
}

async function main() {
  const probe = new PrismaClient();
  const user = await probe.user.findFirst({ where: { email: TARGET_EMAIL } });
  if (!user) throw new Error('user not found');
  if (!user.familyId) throw new Error('activeFamilyId is null');
  const userPk = user.id;
  const familyId = user.familyId;

  // 리셋
  await probe.user.update({ where: { id: userPk }, data: { lastHeartGrantedAt: null } });
  const before = await probe.familyMembership.findUnique({
    where: { userId_familyId: { userId: userPk, familyId } },
  });
  console.log(`BEFORE: hearts=${before?.hearts}  lastHeartGrantedAt=null`);

  // 분리된 PrismaClient N 개로 동시 호출
  const clients = Array.from({ length: CONCURRENCY }, () => new PrismaClient());
  const t0 = Date.now();
  await Promise.all(clients.map((c) => recordAccessOnce(c, userPk, familyId)));
  const elapsed = Date.now() - t0;

  const after = await probe.familyMembership.findUnique({
    where: { userId_familyId: { userId: userPk, familyId } },
  });
  const u = await probe.user.findUniqueOrThrow({ where: { id: userPk } });

  const delta = (after?.hearts ?? 0) - (before?.hearts ?? 0);
  console.log(`AFTER  ${CONCURRENCY} concurrent calls (${elapsed}ms): hearts=${after?.hearts}  delta=${delta}`);
  console.log(`lastHeartGrantedAt=${u.lastHeartGrantedAt?.toISOString()}`);
  console.log(delta === 1 ? 'PASS — race 차단 정상' : `FAIL — delta=${delta} (expected 1)`);

  await Promise.all(clients.map((c) => c.$disconnect()));
  await probe.$disconnect();
  if (delta !== 1) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
