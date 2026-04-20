import { ScheduledEvent, Context } from 'aws-lambda';
import prisma from './utils/prisma';
import { NotificationService } from './services/NotificationService';
import { PushNotificationService } from './services/PushNotificationService';
import { getPushMessages } from './utils/i18n/push';

const notificationService = new NotificationService();
const pushService = new PushNotificationService();

export const REMINDER_WINDOW_DAYS = 7;
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
 * MG-19: 저녁 7시 리마인더 알림 (KST 19:00 스케줄, type=REMINDER).
 *
 * 조건:
 *   - 최근 REMINDER_WINDOW_DAYS 이내 배정된 모든 DailyQuestion
 *   - 가족 내 미답변 멤버가 1명 이상일 때에만 해당 가족을 리마인드 대상으로 포함
 *   - 발송 대상은 **그룹 전원** (답변자 + 미답변자) — 클라이언트에서 type=REMINDER 로 라우팅
 *   - 메시지 분기 (사용자별 해당 가족의 오늘 답변 여부 기준):
 *       · 답변자:   title "미답변자가 있어요" / body "그룹에 접속해서 재촉하기를 해봐요"
 *       · 미답변자: title "오늘 질문에 답변하지 않았어요" / body "그룹에 접속해서 답변을 달아봐요"
 *   - 유저당 푸시 1회 (다중 가족 소속 시 중복 발송 방지). 분기는 "해당 유저가 어느 가족이라도
 *     미답변이면 미답변자 문구" 우선 — 본인 미답변 케이스가 더 긴급하기 때문.
 *   - DB 알림은 (유저, 가족) 단위 1건 — 클라이언트 알림 리스트에서 가족별 행으로 표시.
 *   - 푸시 대상은 사용자별 `notifQuestion` 토글 존중.
 *
 * MG-12 의 ANSWERER_NUDGE 경로는 본 REMINDER 경로로 통합됨 (답변자 전용 메시지 분기로 승계).
 * 수동 재촉(NudgeService → type ANSWER_REQUEST) 및 답변완료(MEMBER_ANSWERED) 경로는 변경 없음.
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

  // 집계:
  //   - userInfoMap:        푸시 대상 유저 정보 (푸시는 유저당 1회)
  //   - dbNotifByKey:       (유저, 가족) → 해당 가족에서 본인이 미답변 1건이라도 있었는지 (분기용)
  //   - userHasUnanswered:  유저 전역으로 어떤 가족이든 본인이 미답변이었는지 (푸시 문구 분기용)
  //   - remindedFamilyIds:  실제로 리마인드 발송 대상이 된 가족 수 (로깅)
  const userInfoMap = new Map<string, MembershipUser>();
  const dbNotifByKey = new Map<string, { userId: string; familyId: string; userUnanswered: boolean }>();
  const userHasUnanswered = new Map<string, boolean>();
  const remindedFamilyIds = new Set<string>();

  for (const dq of candidateDQs) {
    const memberships = membershipsByFamily.get(dq.familyId);
    if (!memberships || memberships.length === 0) continue;

    const answeredSet = answeredByQuestion.get(dq.questionId);

    // 이 질문의 미답변자(skip 제외) — 1명 이상이어야 리마인드 발송
    const unfinished = memberships.filter(
      (m) => !(answeredSet?.has(m.userId) ?? false) && !isSameDate(m.skippedDate, dq.date)
    );
    if (unfinished.length === 0) continue;

    // 그룹 전원(답변자+미답변자) 을 발송 대상으로 등록
    for (const m of memberships) {
      const user = m.user;
      if (!user) continue;
      // skip 멤버는 본인 의사로 오늘 건너뛰기 했으므로 리마인드 대상에서 제외
      if (isSameDate(m.skippedDate, dq.date)) continue;

      if (!userInfoMap.has(m.userId)) userInfoMap.set(m.userId, user);

      const selfUnanswered = !(answeredSet?.has(m.userId) ?? false);
      if (selfUnanswered) userHasUnanswered.set(m.userId, true);
      else if (!userHasUnanswered.has(m.userId)) userHasUnanswered.set(m.userId, false);

      const key = `${m.userId}:${dq.familyId}`;
      const existing = dbNotifByKey.get(key);
      if (!existing) {
        dbNotifByKey.set(key, {
          userId: m.userId,
          familyId: dq.familyId,
          userUnanswered: selfUnanswered,
        });
      } else if (selfUnanswered) {
        existing.userUnanswered = true; // 미답변 우선
      }
    }
    remindedFamilyIds.add(dq.familyId);
  }

  function makeBody(locale: string | null, unanswered: boolean): { title: string; body: string } {
    const msgs = getPushMessages(locale);
    const set = unanswered ? msgs.reminder.unanswered : msgs.reminder.answered;
    return { title: set.title, body: set.body };
  }

  // DB 알림 — (유저, 가족) 단위 1건. 본인이 해당 가족에서 미답변이면 미답변자 문구, 아니면 답변자 문구.
  const dbNotifTasks: Promise<unknown>[] = [];
  for (const entry of dbNotifByKey.values()) {
    const user = userInfoMap.get(entry.userId);
    if (!user) continue;
    const { title, body } = makeBody(user.locale, entry.userUnanswered);
    dbNotifTasks.push(
      notificationService
        .createNotification(entry.userId, 'REMINDER', title, body, entry.familyId)
        .catch((e) => {
          console.warn('[Reminder] 알림 저장 실패:', e);
        })
    );
  }
  await Promise.all(dbNotifTasks);

  // 푸시 — 유저당 1회. 유저가 어느 가족에서든 미답변이면 미답변자 문구 사용(본인 답변이 더 긴급).
  const pushTasks: Promise<unknown>[] = [];
  for (const [userId, user] of userInfoMap) {
    if (!user.notifQuestion) continue;
    const unanswered = userHasUnanswered.get(userId) ?? false;
    const { title, body } = makeBody(user.locale, unanswered);

    if (user.apnsToken) {
      pushTasks.push(
        (async () => {
          const badgeCount = await notificationService.getUnreadCount(userId);
          await pushService.sendApnsPush(
            user.apnsToken!,
            title,
            body,
            'REMINDER',
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
          .sendFcmPush(user.fcmToken, title, body, 'REMINDER')
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
}

export const handler = async (_event: ScheduledEvent, _context: Context): Promise<void> => {
  try {
    await sendDailyReminders();
  } catch (err) {
    console.error('[Reminder] Failed to send reminders:', err);
    throw err;
  }
};
