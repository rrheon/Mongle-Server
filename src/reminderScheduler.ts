import { ScheduledEvent, Context } from 'aws-lambda';
import prisma from './utils/prisma';
import { NotificationService } from './services/NotificationService';
import { PushNotificationService } from './services/PushNotificationService';
import { getPushMessages } from './utils/i18n/push';
import { isInQuietHours } from './utils/quietHours';

const notificationService = new NotificationService();
const pushService = new PushNotificationService();

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

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
 *   - 대상은 각 가족의 **현재 활성(가장 최근 배정) DailyQuestion 1개** — MG-16 의
 *     carry-over 정책(자동교체 없음, 최신 DQ 무기한 유지)과 일관됨.
 *     이전 버전(7일 윈도우)은 과거 미답변 질문까지 미답변자 문구로 묶여서 "오늘 그룹
 *     전원 답변했는데 왜 답변 안 했다고 나오지?"라는 UX 혼란을 유발했다.
 *   - 해당 활성 DQ 에서 미답변 멤버가 1명 이상일 때에만 리마인드 대상 가족으로 포함.
 *   - 발송 대상은 **그룹 전원** (답변자 + 미답변자) — 클라이언트에서 type=REMINDER 로 라우팅.
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
  // 각 가족의 활성(가장 최근) DQ 1건만 후보로 선정.
  // Prisma distinct + orderBy 로 PostgreSQL DISTINCT ON (family_id) 유사 동작.
  // 날짜 상한을 두지 않는 이유:
  //   - DailyQuestion.date 는 @db.Date 라 DB 값이 `YYYY-MM-DD T00:00:00Z`(UTC 자정)
  //   - getKstMidnightUtc() 는 "KST 자정의 UTC 시각" 이라 `YYYY-MM-DD-1 T15:00:00Z`
  //   - 두 값을 lte 로 비교하면 **오늘 배정된 DQ 가 제외**되는 off-by-one 발생
  //   - 미래 DQ 는 현재 발행 정책상 존재하지 않으므로 상한 불필요
  const candidateDQs = await prisma.dailyQuestion.findMany({
    distinct: ['familyId'],
    orderBy: [{ familyId: 'asc' }, { date: 'desc' }],
    select: { id: true, questionId: true, familyId: true, date: true },
  });
  if (candidateDQs.length === 0) {
    console.log('[Reminder] No active DQs found');
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
          apnsEnvironment: true,
          fcmToken: true,
          locale: true,
          notifQuestion: true,
          quietHoursEnabled: true,
          quietHoursStart: true,
          quietHoursEnd: true,
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
  // 한 유저가 여러 가족 소속이면 여러 알림 생성되지만 푸시는 유저당 1회 발송 → 첫 알림 ID 만
  // 페이로드 notificationId 로 포함해 클라가 자동 markAsRead. 나머지 가족 REMINDER 는 알림함에서 정리. (MG-111)
  const firstNotifIdByUser = new Map<string, string>();
  const dbNotifTasks: Promise<unknown>[] = [];
  for (const entry of dbNotifByKey.values()) {
    const user = userInfoMap.get(entry.userId);
    if (!user) continue;
    const { title, body } = makeBody(user.locale, entry.userUnanswered);
    dbNotifTasks.push(
      notificationService
        .createNotification(entry.userId, 'REMINDER', title, body, entry.familyId)
        .then((notifId) => {
          if (!firstNotifIdByUser.has(entry.userId)) {
            firstNotifIdByUser.set(entry.userId, notifId);
          }
        })
        .catch((e) => {
          console.warn('[Reminder] 알림 저장 실패:', e);
        })
    );
  }
  await Promise.all(dbNotifTasks);

  // badge 카운트 — NotificationService.getUnreadCount 로 통일 (MG-127).
  // 이전 batch groupBy 는 user.createdAt / 14일 TTL 컷오프를 우회해 가입 이전 알림과
  // 오래된 누적이 푸시 페이로드 badge 에 그대로 박혔음. user 별 가변 컷오프는
  // groupBy 로 표현 불가 → 메서드 재사용 + Promise.all 병렬로 round trip 평탄화.
  const pushUserIds = Array.from(userInfoMap.keys());
  const unreadByUser = new Map<string, number>();
  await Promise.all(
    pushUserIds.map(async (uid) => {
      const cnt = await notificationService.getUnreadCount(uid);
      unreadByUser.set(uid, cnt);
    })
  );

  // 푸시 — 유저당 1회. 유저가 어느 가족에서든 미답변이면 미답변자 문구 사용(본인 답변이 더 긴급).
  const pushTasks: Promise<unknown>[] = [];
  for (const [userId, user] of userInfoMap) {
    if (!user.notifQuestion) continue;
    if (isInQuietHours(user)) continue;
    const unanswered = userHasUnanswered.get(userId) ?? false;
    const { title, body } = makeBody(user.locale, unanswered);
    const badgeCount = unreadByUser.get(userId) ?? 0;

    const notifId = firstNotifIdByUser.get(userId);
    // MG-116 — 클라가 알림 탭 시 본인 미답변 여부에 따라 답변 화면 vs 홈 화면으로 분기
    // 할 수 있도록 push payload type 에 suffix 부여. DB Notification.type 은 'REMINDER'
    // 그대로 유지(알림함 라우팅 영향 없음). 여러 가족 소속이면 어느 가족에서든
    // 본인 미답변이 1건이라도 있으면 unanswered=true.
    const pushType = unanswered ? 'REMINDER_UNANSWERED' : 'REMINDER_ANSWERED';
    if (user.apnsToken) {
      pushTasks.push(
        pushService.sendApnsPush(
          user.apnsToken!,
          title,
          body,
          pushType,
          badgeCount,
          user.apnsEnvironment,
          notifId
        ).catch((e) => {
          console.warn('[Reminder] APNs 푸시 실패:', e);
        })
      );
    }
    if (user.fcmToken) {
      pushTasks.push(
        pushService
          .sendFcmPush(user.fcmToken, title, body, pushType, undefined, notifId)
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
