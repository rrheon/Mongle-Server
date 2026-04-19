import { ScheduledEvent, Context } from 'aws-lambda';
import prisma from './utils/prisma';
import { NotificationService } from './services/NotificationService';
import { PushNotificationService } from './services/PushNotificationService';
import { getPushMessages } from './utils/i18n/push';

const notificationService = new NotificationService();
const pushService = new PushNotificationService();

export const REMINDER_WINDOW_DAYS = 7;
export const ANSWERER_NUDGE_WINDOW_DAYS = 4;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 현재 시점의 KST 자정을 UTC Date 로 반환.
 * 윈도우 경계를 한국 기준으로 고정해서 UTC 0~9시 구간의 off-by-one 을 제거한다.
 */
export function getKstMidnightUtc(now: Date = new Date()): Date {
  const nowInKst = new Date(now.getTime() + KST_OFFSET_MS);
  const kstMidnight = Date.UTC(
    nowInKst.getUTCFullYear(),
    nowInKst.getUTCMonth(),
    nowInKst.getUTCDate()
  );
  return new Date(kstMidnight - KST_OFFSET_MS);
}

function isSameDate(a: Date | null | undefined, b: Date | null | undefined): boolean {
  if (!a || !b) return false;
  return a.toISOString().split('T')[0] === b.toISOString().split('T')[0];
}

/**
 * 자동 재촉 알림 발송 (KST 19:00 스케줄).
 *
 * 조건:
 *   - 최근 REMINDER_WINDOW_DAYS 이내 배정된 모든 DailyQuestion
 *   - 아직 답변/패스하지 않은 멤버에게만
 *   - 유저당 1회 푸시 (다중 그룹 소속, 다건 미답변이어도 중복 발송 없음)
 *   - DB 알림은 (유저, 가족) 단위 1건으로 제한하여 과도한 알림 방지
 *   - 미답변 2건 이상이면 bodyMulti(count) 로 묶어 표시
 *
 * 전원이 이미 완료된 경우는 건너뜀.
 */
export async function sendDailyReminders(): Promise<void> {
  const kstMidnight = getKstMidnightUtc();
  const windowStart = new Date(kstMidnight.getTime() - REMINDER_WINDOW_DAYS * DAY_MS);

  const candidateDQs = await prisma.dailyQuestion.findMany({
    where: { date: { gte: windowStart } },
    orderBy: { date: 'desc' },
    select: { id: true, questionId: true, familyId: true, date: true },
  });
  if (candidateDQs.length === 0) {
    console.log('[Reminder] No candidate questions in window');
    return;
  }

  // 답변자 재촉(answerer nudge) 윈도우는 미답변 재촉보다 짧음 (기본 4일 = 오늘+과거 3일)
  const answererNudgeWindowStart = new Date(
    kstMidnight.getTime() - ANSWERER_NUDGE_WINDOW_DAYS * DAY_MS
  );

  // 배치 조회 ①: 해당 가족들의 멤버십 일괄 조회 (N+1 제거)
  const familyIds = Array.from(new Set(candidateDQs.map((dq) => dq.familyId)));
  const allMemberships = await prisma.familyMembership.findMany({
    where: { familyId: { in: familyIds } },
    select: {
      userId: true,
      familyId: true,
      skippedDate: true,
      user: {
        select: {
          id: true,
          apnsToken: true,
          fcmToken: true,
          locale: true,
          notifQuestion: true,
          notifAnswererNudge: true,
        },
      },
    },
  });
  type Membership = (typeof allMemberships)[number];
  type MembershipUser = NonNullable<Membership['user']>;

  const membershipsByFamily = new Map<string, Membership[]>();
  for (const m of allMemberships) {
    const arr = membershipsByFamily.get(m.familyId);
    if (arr) arr.push(m);
    else membershipsByFamily.set(m.familyId, [m]);
  }

  // 배치 조회 ②: 해당 질문들의 답변 일괄 조회 (N+1 제거)
  const questionIds = Array.from(new Set(candidateDQs.map((dq) => dq.questionId)));
  const userIds = Array.from(new Set(allMemberships.map((m) => m.userId)));
  const allAnswers =
    questionIds.length && userIds.length
      ? await prisma.answer.findMany({
          where: {
            questionId: { in: questionIds },
            userId: { in: userIds },
          },
          select: { questionId: true, userId: true },
        })
      : [];
  const answeredByQuestion = new Map<string, Set<string>>();
  for (const a of allAnswers) {
    const set = answeredByQuestion.get(a.questionId);
    if (set) set.add(a.userId);
    else answeredByQuestion.set(a.questionId, new Set([a.userId]));
  }

  // 집계: 유저별 미답변 카운트, (유저, 가족) 키, 푸시 대상 유저 정보
  const unansweredCountByUser = new Map<string, number>();
  const userInfoMap = new Map<string, MembershipUser>();
  const dbNotifKeys = new Set<string>(); // `${userId}:${familyId}`
  const remindedFamilyIds = new Set<string>();

  for (const dq of candidateDQs) {
    const memberships = membershipsByFamily.get(dq.familyId);
    if (!memberships || memberships.length === 0) continue;

    const answeredSet = answeredByQuestion.get(dq.questionId);
    const unfinished = memberships.filter(
      (m) => !(answeredSet?.has(m.userId) ?? false) && !isSameDate(m.skippedDate, dq.date)
    );
    if (unfinished.length === 0) continue;

    for (const m of unfinished) {
      const user = m.user;
      if (!user) continue;
      unansweredCountByUser.set(
        m.userId,
        (unansweredCountByUser.get(m.userId) ?? 0) + 1
      );
      if (!userInfoMap.has(m.userId)) userInfoMap.set(m.userId, user);
      dbNotifKeys.add(`${m.userId}:${dq.familyId}`);
    }
    remindedFamilyIds.add(dq.familyId);
  }

  function makeBody(locale: string | null, count: number): { title: string; body: string } {
    const msgs = getPushMessages(locale);
    return {
      title: msgs.answerReminder.title,
      body: count > 1 ? msgs.answerReminder.bodyMulti(count) : msgs.answerReminder.body,
    };
  }

  // DB 알림 — (유저, 가족) 단위 1건
  const dbNotifTasks: Promise<unknown>[] = [];
  for (const key of dbNotifKeys) {
    const [userId, familyIdForNotif] = key.split(':');
    const user = userInfoMap.get(userId);
    if (!user) continue;
    const count = unansweredCountByUser.get(userId) ?? 1;
    const { title, body } = makeBody(user.locale, count);
    dbNotifTasks.push(
      notificationService
        .createNotification(userId, 'ANSWER_REQUEST', title, body, familyIdForNotif)
        .catch((e) => {
          console.warn('[Reminder] 알림 저장 실패:', e);
        })
    );
  }
  await Promise.all(dbNotifTasks);

  // 푸시 — 유저당 1회
  const pushTasks: Promise<unknown>[] = [];
  for (const [userId, user] of userInfoMap) {
    if (!user.notifQuestion) continue;
    const count = unansweredCountByUser.get(userId) ?? 1;
    const { title, body } = makeBody(user.locale, count);

    if (user.apnsToken) {
      pushTasks.push(
        (async () => {
          const badgeCount = await notificationService.getUnreadCount(userId);
          await pushService.sendApnsPush(
            user.apnsToken!,
            title,
            body,
            'ANSWER_REQUEST',
            badgeCount
          );
        })().catch((e) => {
          console.warn('[Reminder] APNs 푸시 실패:', e);
        })
      );
    }
    if (user.fcmToken) {
      pushTasks.push(
        pushService
          .sendFcmPush(user.fcmToken, title, body, 'ANSWER_REQUEST')
          .catch((e) => {
            console.warn('[Reminder] FCM 푸시 실패:', e);
          })
      );
    }
  }
  await Promise.all(pushTasks);

  console.log(
    `[Reminder] Reminded ${userInfoMap.size} unique users across ${remindedFamilyIds.size} families`
  );

  // ────────────────────────────────────────────────────────────
  // MG-12: 답변자 재촉(answerer nudge)
  //   - 본인은 답변 완료 + 같은 가족 중 최소 1명 미답변
  //   - 4일 윈도우(오늘+과거 3일). 미답변 재촉(7일)보다 짧게 → 알림 피로 감소
  //   - 푸시는 유저당 1회, DB 알림은 (유저, 가족) 단위
  // ────────────────────────────────────────────────────────────

  // 답변자별 집계: 몇 개 질문에서 가족 미답변 상태로 남았는지(questionCount), 총 몇 명 대기 중(pendingMembers)
  const answererQuestionCount = new Map<string, number>();
  const answererPendingCount = new Map<string, number>();
  const answererUserMap = new Map<string, MembershipUser>();
  const answererDbKeys = new Set<string>(); // `${userId}:${familyId}`
  const answererNudgedFamilyIds = new Set<string>();

  for (const dq of candidateDQs) {
    if (dq.date < answererNudgeWindowStart) continue; // 4일 윈도우 밖 제외

    const memberships = membershipsByFamily.get(dq.familyId);
    if (!memberships || memberships.length < 2) continue; // 1인 가족 스킵

    const answeredSet = answeredByQuestion.get(dq.questionId);
    if (!answeredSet || answeredSet.size === 0) continue;

    // 해당 질문 기준 미답변(그리고 skip 아님) 멤버 수
    const pending = memberships.filter(
      (m) => !(answeredSet.has(m.userId)) && !isSameDate(m.skippedDate, dq.date)
    );
    if (pending.length === 0) continue; // 전원 답변/스킵 → 재촉 불필요

    // 이 질문에 답변한 멤버 = 답변자 후보
    for (const m of memberships) {
      if (!answeredSet.has(m.userId)) continue;
      const user = m.user;
      if (!user) continue;
      answererQuestionCount.set(
        m.userId,
        (answererQuestionCount.get(m.userId) ?? 0) + 1
      );
      // pendingCount 는 가장 많았던 질문 기준(대표값) — 단일 질문 시 이 값이 본문 표시됨
      const prevPending = answererPendingCount.get(m.userId) ?? 0;
      if (pending.length > prevPending) answererPendingCount.set(m.userId, pending.length);
      if (!answererUserMap.has(m.userId)) answererUserMap.set(m.userId, user);
      answererDbKeys.add(`${m.userId}:${dq.familyId}`);
    }
    answererNudgedFamilyIds.add(dq.familyId);
  }

  function makeAnswererBody(
    locale: string | null,
    questionCount: number,
    pendingCount: number
  ): { title: string; body: string } {
    const msgs = getPushMessages(locale);
    return {
      title: msgs.answererNudge.title,
      body:
        questionCount > 1
          ? msgs.answererNudge.bodyMulti(questionCount)
          : msgs.answererNudge.body(pendingCount),
    };
  }

  // DB 알림
  const answererDbTasks: Promise<unknown>[] = [];
  for (const key of answererDbKeys) {
    const [userId, familyIdForNotif] = key.split(':');
    const user = answererUserMap.get(userId);
    if (!user) continue;
    const questionCount = answererQuestionCount.get(userId) ?? 1;
    const pendingCount = answererPendingCount.get(userId) ?? 1;
    const { title, body } = makeAnswererBody(user.locale, questionCount, pendingCount);
    answererDbTasks.push(
      notificationService
        .createNotification(userId, 'ANSWERER_NUDGE', title, body, familyIdForNotif)
        .catch((e) => {
          console.warn('[AnswererNudge] 알림 저장 실패:', e);
        })
    );
  }
  await Promise.all(answererDbTasks);

  // 푸시 — 유저당 1회
  const answererPushTasks: Promise<unknown>[] = [];
  for (const [userId, user] of answererUserMap) {
    if (!user.notifAnswererNudge) continue;
    const questionCount = answererQuestionCount.get(userId) ?? 1;
    const pendingCount = answererPendingCount.get(userId) ?? 1;
    const { title, body } = makeAnswererBody(user.locale, questionCount, pendingCount);

    if (user.apnsToken) {
      answererPushTasks.push(
        (async () => {
          const badgeCount = await notificationService.getUnreadCount(userId);
          await pushService.sendApnsPush(
            user.apnsToken!,
            title,
            body,
            'ANSWERER_NUDGE',
            badgeCount
          );
        })().catch((e) => {
          console.warn('[AnswererNudge] APNs 푸시 실패:', e);
        })
      );
    }
    if (user.fcmToken) {
      answererPushTasks.push(
        pushService
          .sendFcmPush(user.fcmToken, title, body, 'ANSWERER_NUDGE')
          .catch((e) => {
            console.warn('[AnswererNudge] FCM 푸시 실패:', e);
          })
      );
    }
  }
  await Promise.all(answererPushTasks);

  console.log(
    `[AnswererNudge] Nudged ${answererUserMap.size} answerers across ${answererNudgedFamilyIds.size} families`
  );
}

export const handler = async (_event: ScheduledEvent, _context: Context): Promise<void> => {
  try {
    await sendDailyReminders();
  } catch (err) {
    console.error('[Reminder] Failed to send reminders:', err);
    throw err;
  }
};
