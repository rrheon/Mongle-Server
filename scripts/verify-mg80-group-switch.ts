/**
 * MG-80 e2e: 같은 KST 날짜 그룹 전환 시 양쪽 그룹 +1 검증.
 *
 * 시나리오:
 *  1) mrdydgjs 의 활성 그룹 A 와 임의 비활성 그룹 B 의 lastHeartGrantedAt 을 null 로 리셋
 *  2) A 에서 grantDailyHeartIfNeeded → A.hearts +=1, A.lastHeartGrantedAt 채워짐
 *  3) 같은 KST 안에 B 로 활성 전환 후 grantDailyHeartIfNeeded → B.hearts +=1, B.lastHeartGrantedAt
 *     채워짐, A 영향 없음 (이전엔 +0 누락)
 *  4) A 로 다시 전환 후 grantDailyHeartIfNeeded → 변동 없음 (A 는 이미 today)
 *
 * 본 스크립트는 read-only API 호출이 아니라 서비스 메서드를 직접 호출하므로
 * 활성 가족 전환은 user.familyId 업데이트로만 시뮬레이트한다 (실제 그룹 선택 API
 * 의 다른 부수효과는 본 검증 범위 밖).
 */
import { PrismaClient } from '@prisma/client';
import { UserService } from '../src/services/UserService';

const TARGET_EMAIL = 'mrdydgjs@naver.com';
const prisma = new PrismaClient();
const service = new UserService();

async function snapshot(userPk: string, label: string) {
  const memberships = await prisma.familyMembership.findMany({
    where: { userId: userPk },
    include: { family: { select: { name: true } } },
  });
  console.log(`\n--- ${label} ---`);
  for (const m of memberships) {
    console.log(
      `  ${m.family.name.padEnd(8)}  hearts=${String(m.hearts).padStart(2)}  ` +
        `granted=${m.lastHeartGrantedAt?.toISOString() ?? 'null'}`
    );
  }
  return memberships;
}

async function main() {
  const user = await prisma.user.findFirst({ where: { email: TARGET_EMAIL } });
  if (!user) throw new Error('user not found');
  const userPk = user.id;
  const originalActiveFamilyId = user.familyId;

  // 그룹 두 개 선택 (활성 = test, 비활성 첫 번째 = zxx 또는 ㅋㅋㅋ)
  const memberships = await prisma.familyMembership.findMany({
    where: { userId: userPk },
    select: { familyId: true, family: { select: { name: true } } },
  });
  const familyA = memberships.find((m) => m.familyId === originalActiveFamilyId);
  const familyB = memberships.find((m) => m.familyId !== originalActiveFamilyId);
  if (!familyA || !familyB) throw new Error('memberships < 2');

  console.log(`A=${familyA.family.name} (active), B=${familyB.family.name}`);

  // 1) 두 멤버십 모두 lastHeartGrantedAt 리셋
  await prisma.familyMembership.updateMany({
    where: { userId: userPk, familyId: { in: [familyA.familyId, familyB.familyId] } },
    data: { lastHeartGrantedAt: null },
  });
  await snapshot(userPk, 'after reset');

  // 2) A 활성 상태에서 getUserByUserId({ grantDailyHeart: true })
  const respA = await service.getUserByUserId(user.userId, { grantDailyHeart: true });
  console.log(
    `\n[step 2] A grant → heartGrantedToday=${respA.heartGrantedToday}, hearts=${respA.hearts}`
  );
  await snapshot(userPk, 'after A grant');

  // 3) B 로 활성 전환 (familyId 만 변경) 후 grant
  await prisma.user.update({ where: { id: userPk }, data: { familyId: familyB.familyId } });
  const respB = await service.getUserByUserId(user.userId, { grantDailyHeart: true });
  console.log(
    `\n[step 3] B grant → heartGrantedToday=${respB.heartGrantedToday}, hearts=${respB.hearts}`
  );
  await snapshot(userPk, 'after B grant');

  // 4) A 로 다시 전환 후 grant — 변동 없어야 함
  await prisma.user.update({ where: { id: userPk }, data: { familyId: familyA.familyId } });
  const respA2 = await service.getUserByUserId(user.userId, { grantDailyHeart: true });
  console.log(
    `\n[step 4] A re-grant → heartGrantedToday=${respA2.heartGrantedToday}, hearts=${respA2.hearts}`
  );
  await snapshot(userPk, 'after A re-grant');

  // 5) opt-in 미포함 호출 → grant 미발동
  const respNoOpt = await service.getUserByUserId(user.userId);
  console.log(
    `\n[step 5] no opt-in → heartGrantedToday=${respNoOpt.heartGrantedToday}, hearts=${respNoOpt.hearts}`
  );

  // 원상복구: 활성 그룹을 원래로
  if (originalActiveFamilyId) {
    await prisma.user.update({
      where: { id: userPk },
      data: { familyId: originalActiveFamilyId },
    });
  }

  // 검증
  const pass2 = respA.heartGrantedToday === true;
  const pass3 = respB.heartGrantedToday === true;
  const pass4 = respA2.heartGrantedToday === false;
  const pass5 = respNoOpt.heartGrantedToday === false;
  console.log(
    `\nresult: step2=${pass2 ? 'PASS' : 'FAIL'}, step3=${pass3 ? 'PASS' : 'FAIL'}, ` +
      `step4=${pass4 ? 'PASS' : 'FAIL'}, step5=${pass5 ? 'PASS' : 'FAIL'}`
  );
  if (!(pass2 && pass3 && pass4 && pass5)) process.exit(2);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
