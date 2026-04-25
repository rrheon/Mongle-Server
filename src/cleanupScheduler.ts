import { ScheduledEvent, Context } from 'aws-lambda';
import prisma from './utils/prisma';

/**
 * 만료/소비된 row 와 무한 누적 가능 테이블을 일괄 정리하는 cron Lambda.
 * KST 04:00 (UTC 19:00) 매일 실행. 보관 기간은 도메인 별로 다름:
 *   - EmailVerification: 만료 또는 consumed=true 후 1일
 *   - UserAccessLog: 90일
 *   - UserRefreshToken: revokedAt 또는 expiresAt 후 30일
 *   - Notification: 읽음 후 90일 / 미읽음 180일
 *
 * Lambda timeout 60초 안에서 deleteMany 단위로 처리 (chunk 안 걸어도 PostgreSQL 인덱스
 * 지원 + 일배치라 충분). 한 도메인 실패해도 나머지는 진행하도록 try/catch 격리.
 */
export async function runCleanup(now: Date = new Date()): Promise<void> {
  const oneDayAgo = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const oneEightyDaysAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);

  const summary: Record<string, number> = {};

  // 1) EmailVerification — 만료된 또는 consumed=true 후 1일 경과
  try {
    const r = await prisma.emailVerification.deleteMany({
      where: {
        OR: [
          { consumed: true, createdAt: { lt: oneDayAgo } },
          { expiresAt: { lt: oneDayAgo } },
        ],
      },
    });
    summary.emailVerification = r.count;
  } catch (e) {
    console.error('[Cleanup] EmailVerification 실패:', e);
  }

  // 2) UserAccessLog — 90일 이전
  try {
    const r = await prisma.userAccessLog.deleteMany({
      where: { createdAt: { lt: ninetyDaysAgo } },
    });
    summary.userAccessLog = r.count;
  } catch (e) {
    console.error('[Cleanup] UserAccessLog 실패:', e);
  }

  // 3) UserRefreshToken — revokedAt 또는 만료 후 30일
  try {
    const r = await prisma.userRefreshToken.deleteMany({
      where: {
        OR: [
          { revokedAt: { lt: thirtyDaysAgo } },
          { expiresAt: { lt: thirtyDaysAgo } },
        ],
      },
    });
    summary.userRefreshToken = r.count;
  } catch (e) {
    console.error('[Cleanup] UserRefreshToken 실패:', e);
  }

  // 4) Notification — 읽음 90일 / 미읽음 180일
  try {
    const rRead = await prisma.notification.deleteMany({
      where: { isRead: true, createdAt: { lt: ninetyDaysAgo } },
    });
    const rUnread = await prisma.notification.deleteMany({
      where: { isRead: false, createdAt: { lt: oneEightyDaysAgo } },
    });
    summary.notificationRead = rRead.count;
    summary.notificationUnread = rUnread.count;
  } catch (e) {
    console.error('[Cleanup] Notification 실패:', e);
  }

  console.log('[Cleanup] 일괄 정리 완료:', summary);
}

export const handler = async (_event: ScheduledEvent, _context: Context): Promise<void> => {
  try {
    await runCleanup();
  } catch (err) {
    console.error('[Cleanup] Lambda 실패:', err);
    throw err;
  }
};
