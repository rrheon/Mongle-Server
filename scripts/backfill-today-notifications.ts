/**
 * MG-22 회귀 백필: 오늘자 DailyQuestion 은 생성됐지만 NEW_QUESTION 알림이
 * 누락된 가족에게 DB 알림 + APNs/FCM 푸시를 소급 발송한다.
 *
 * scheduler.ts 의 L88 `prisma.user.findMany({...apnsEnvironment...})` 가
 * 마이그레이션 누락 상태에서 throw 하면, 같은 루프 앞쪽의 DailyQuestion.create
 * 는 이미 커밋된 뒤라 "질문은 갱신됐는데 알림만 없음" 상태가 된다.
 *
 * 이 스크립트는 **멱등** 하다 — 이미 NEW_QUESTION 알림이 있는 (userId, familyId,
 * today) 조합은 건너뛴다. 여러 번 돌려도 중복 발송되지 않는다.
 *
 * 사용:
 *   npx ts-node scripts/backfill-today-notifications.ts --dry-run   # 대상만 출력
 *   npx ts-node scripts/backfill-today-notifications.ts             # 실제 발송
 *
 * 반드시 prisma migrate deploy 로 apns_environment 컬럼을 먼저 적용한 뒤 실행.
 */

import prisma from '../src/utils/prisma';
import { NotificationService } from '../src/services/NotificationService';
import { PushNotificationService } from '../src/services/PushNotificationService';
import { getPushMessages } from '../src/utils/i18n/push';

const notificationService = new NotificationService();
const pushService = new PushNotificationService();

function getKstToday(): Date {
  const now = new Date();
  const kstDateStr = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
  return new Date(kstDateStr + 'T00:00:00.000Z');
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const today = getKstToday();
  console.log(`[Backfill] today (KST UTC-midnight) = ${today.toISOString()} dryRun=${dryRun}`);

  const dqs = await prisma.dailyQuestion.findMany({
    where: { date: today },
    select: { familyId: true, questionId: true, date: true },
  });
  console.log(`[Backfill] DailyQuestion(today) = ${dqs.length} families`);

  const pushTargets = new Map<
    string,
    {
      apnsToken: string | null;
      apnsEnvironment: 'sandbox' | 'production' | null;
      fcmToken: string | null;
      locale: string | null;
      notifQuestion: boolean;
    }
  >();

  let dbCreated = 0;
  let dbSkipped = 0;

  for (const dq of dqs) {
    const members = await prisma.user.findMany({
      where: { familyId: dq.familyId },
      select: {
        id: true,
        apnsToken: true,
        apnsEnvironment: true,
        fcmToken: true,
        locale: true,
        notifQuestion: true,
      },
    });

    for (const member of members) {
      const existing = await prisma.notification.findFirst({
        where: {
          userId: member.id,
          familyId: dq.familyId,
          type: 'NEW_QUESTION',
          createdAt: { gte: today },
        },
        select: { id: true },
      });

      if (existing) {
        dbSkipped++;
      } else {
        const msgs = getPushMessages(member.locale);
        if (!dryRun) {
          await notificationService
            .createNotification(member.id, 'NEW_QUESTION', msgs.newQuestion.title, msgs.newQuestion.body, dq.familyId)
            .catch((e) => {
              console.warn(`[Backfill] DB 알림 저장 실패 user=${member.id} family=${dq.familyId}:`, e);
            });
        }
        dbCreated++;
      }

      if (!pushTargets.has(member.id)) {
        pushTargets.set(member.id, {
          apnsToken: member.apnsToken,
          apnsEnvironment: member.apnsEnvironment,
          fcmToken: member.fcmToken,
          locale: member.locale,
          notifQuestion: member.notifQuestion,
        });
      }
    }
  }

  console.log(`[Backfill] DB 알림: 생성 ${dbCreated} / 스킵(이미 존재) ${dbSkipped}`);

  let apnsSent = 0;
  let fcmSent = 0;
  let pushSkippedByPref = 0;

  for (const [userId, target] of pushTargets) {
    if (!target.notifQuestion) {
      pushSkippedByPref++;
      continue;
    }
    const msgs = getPushMessages(target.locale);
    const title = msgs.newQuestion.title;
    const body = msgs.newQuestion.body;

    if (target.apnsToken) {
      if (!dryRun) {
        try {
          const badgeCount = await notificationService.getUnreadCount(userId);
          await pushService.sendApnsPush(target.apnsToken, title, body, 'NEW_QUESTION', badgeCount, target.apnsEnvironment);
          apnsSent++;
        } catch (e) {
          console.warn(`[Backfill] APNs 실패 user=${userId}:`, e);
        }
      } else {
        apnsSent++;
      }
    }
    if (target.fcmToken) {
      if (!dryRun) {
        try {
          await pushService.sendFcmPush(target.fcmToken, title, body, 'NEW_QUESTION');
          fcmSent++;
        } catch (e) {
          console.warn(`[Backfill] FCM 실패 user=${userId}:`, e);
        }
      } else {
        fcmSent++;
      }
    }
  }

  console.log(
    `[Backfill] 푸시: APNs ${apnsSent} / FCM ${fcmSent} / 설정off로 스킵 ${pushSkippedByPref} / 유니크 유저 ${pushTargets.size}`
  );
  console.log(`[Backfill] 완료 (dryRun=${dryRun})`);
}

main()
  .catch((e) => {
    console.error('[Backfill] 실패:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
