/**
 * MG-80 backfill: copy User.last_heart_granted_at into the active membership row.
 *
 * Schema diff (prisma db push) 가 column 만 추가하므로, 마이그레이션 파일에 정의된
 * UPDATE backfill 을 별도 스크립트로 1회 실행한다. 본 스크립트는 idempotent —
 * 활성 가족 행 중 NULL 인 것만 채워넣고, 이미 값이 있는 행은 그대로 둔다.
 *
 * 사용: npx ts-node scripts/backfill-membership-heart-granted.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const result = await prisma.$executeRaw`
    UPDATE family_memberships fm
    SET last_heart_granted_at = u.last_heart_granted_at
    FROM users u
    WHERE fm.user_id = u.id
      AND fm.family_id = u.family_id
      AND u.last_heart_granted_at IS NOT NULL
      AND fm.last_heart_granted_at IS NULL
  `;
  console.log(`backfilled rows: ${result}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
