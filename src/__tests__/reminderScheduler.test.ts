// Mock 변수는 jest.mock factory에서 참조되므로 `mock` 접두사 필요 (ts-jest 호이스팅 규칙)
const mockDQFindMany = jest.fn();
const mockMembershipFindMany = jest.fn();
const mockAnswerFindMany = jest.fn();

jest.mock('../utils/prisma', () => ({
  __esModule: true,
  default: {
    dailyQuestion: { findMany: mockDQFindMany },
    familyMembership: { findMany: mockMembershipFindMany },
    answer: { findMany: mockAnswerFindMany },
  },
}));

const mockCreateNotification = jest.fn().mockResolvedValue(undefined);
const mockGetUnreadCount = jest.fn().mockResolvedValue(0);
jest.mock('../services/NotificationService', () => ({
  NotificationService: jest.fn().mockImplementation(() => ({
    createNotification: mockCreateNotification,
    getUnreadCount: mockGetUnreadCount,
  })),
}));

const mockSendApnsPush = jest.fn().mockResolvedValue(undefined);
const mockSendFcmPush = jest.fn().mockResolvedValue(undefined);
jest.mock('../services/PushNotificationService', () => ({
  PushNotificationService: jest.fn().mockImplementation(() => ({
    sendApnsPush: mockSendApnsPush,
    sendFcmPush: mockSendFcmPush,
  })),
}));

import { sendDailyReminders, getKstMidnightUtc } from '../reminderScheduler';

const mockUser = {
  id: 'user-1',
  apnsToken: 'apns-token',
  fcmToken: null,
  locale: 'ko',
  notifQuestion: true,
  notifAnswererNudge: true,
};

describe('getKstMidnightUtc', () => {
  it('UTC 낮 시각 → 해당 KST 날짜의 자정(UTC 기준) 반환', () => {
    // 2026-04-17 13:00 UTC = 2026-04-17 22:00 KST → KST 2026-04-17 00:00 = UTC 2026-04-16 15:00
    const now = new Date('2026-04-17T13:00:00Z');
    expect(getKstMidnightUtc(now).toISOString()).toBe('2026-04-16T15:00:00.000Z');
  });

  it('UTC 새벽 시각(KST 오전) → 동일한 KST 날짜의 자정 반환', () => {
    // 2026-04-17 01:00 UTC = 2026-04-17 10:00 KST → KST 2026-04-17 00:00 = UTC 2026-04-16 15:00
    const now = new Date('2026-04-17T01:00:00Z');
    expect(getKstMidnightUtc(now).toISOString()).toBe('2026-04-16T15:00:00.000Z');
  });

  it('UTC 0시(KST 오전 9시) 경계 — KST 날짜 기준으로 계산되어 off-by-one 없음', () => {
    // 2026-04-17 00:00 UTC = 2026-04-17 09:00 KST → KST 2026-04-17 00:00 = UTC 2026-04-16 15:00
    const now = new Date('2026-04-17T00:00:00Z');
    expect(getKstMidnightUtc(now).toISOString()).toBe('2026-04-16T15:00:00.000Z');
  });
});

describe('sendDailyReminders', () => {
  it('후보 DailyQuestion이 없으면 배치 조회와 알림 호출을 건너뛴다', async () => {
    mockDQFindMany.mockResolvedValue([]);

    await sendDailyReminders();

    expect(mockMembershipFindMany).not.toHaveBeenCalled();
    expect(mockAnswerFindMany).not.toHaveBeenCalled();
    expect(mockCreateNotification).not.toHaveBeenCalled();
    expect(mockSendApnsPush).not.toHaveBeenCalled();
  });

  it('미답변 멤버에게 DB 알림과 APNs 푸시를 각 1회 발송한다', async () => {
    mockDQFindMany.mockResolvedValue([
      { id: 'dq-1', questionId: 'q-1', familyId: 'fam-1', date: new Date('2026-04-17') },
    ]);
    mockMembershipFindMany.mockResolvedValue([
      { userId: 'user-1', familyId: 'fam-1', skippedDate: null, user: mockUser },
    ]);
    mockAnswerFindMany.mockResolvedValue([]);

    await sendDailyReminders();

    expect(mockCreateNotification).toHaveBeenCalledTimes(1);
    expect(mockCreateNotification).toHaveBeenCalledWith(
      'user-1',
      'ANSWER_REQUEST',
      expect.any(String),
      expect.any(String),
      'fam-1'
    );
    expect(mockSendApnsPush).toHaveBeenCalledTimes(1);
    expect(mockSendFcmPush).not.toHaveBeenCalled();
  });

  it('전원 답변 완료 시 알림을 발송하지 않는다', async () => {
    mockDQFindMany.mockResolvedValue([
      { id: 'dq-1', questionId: 'q-1', familyId: 'fam-1', date: new Date('2026-04-17') },
    ]);
    mockMembershipFindMany.mockResolvedValue([
      { userId: 'user-1', familyId: 'fam-1', skippedDate: null, user: mockUser },
    ]);
    mockAnswerFindMany.mockResolvedValue([{ questionId: 'q-1', userId: 'user-1' }]);

    await sendDailyReminders();

    expect(mockCreateNotification).not.toHaveBeenCalled();
    expect(mockSendApnsPush).not.toHaveBeenCalled();
  });

  it('skippedDate가 dq.date와 동일하면 해당 멤버는 대상에서 제외된다', async () => {
    const dqDate = new Date('2026-04-15T00:00:00Z');
    mockDQFindMany.mockResolvedValue([
      { id: 'dq-1', questionId: 'q-1', familyId: 'fam-1', date: dqDate },
    ]);
    mockMembershipFindMany.mockResolvedValue([
      { userId: 'user-1', familyId: 'fam-1', skippedDate: dqDate, user: mockUser },
    ]);
    mockAnswerFindMany.mockResolvedValue([]);

    await sendDailyReminders();

    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  it('동일 유저의 미답변 복수 건이어도 (유저, 가족) 단위 1건으로 통합되며, 문구는 카운트 없이 단순화된다', async () => {
    mockDQFindMany.mockResolvedValue([
      { id: 'dq-1', questionId: 'q-1', familyId: 'fam-1', date: new Date('2026-04-17') },
      { id: 'dq-2', questionId: 'q-2', familyId: 'fam-1', date: new Date('2026-04-16') },
      { id: 'dq-3', questionId: 'q-3', familyId: 'fam-1', date: new Date('2026-04-15') },
    ]);
    mockMembershipFindMany.mockResolvedValue([
      { userId: 'user-1', familyId: 'fam-1', skippedDate: null, user: mockUser },
    ]);
    mockAnswerFindMany.mockResolvedValue([]);

    await sendDailyReminders();

    // (유저, 가족) 단위 1건
    expect(mockCreateNotification).toHaveBeenCalledTimes(1);
    const title = mockCreateNotification.mock.calls[0][2] as string;
    const body = mockCreateNotification.mock.calls[0][3] as string;
    expect(title).toBe('오늘의 질문, 아직 답변 전이에요');
    expect(body).not.toMatch(/\d+건/); // "N건" 형식 문구 제거 확인
    // 푸시도 1회
    expect(mockSendApnsPush).toHaveBeenCalledTimes(1);
  });

  it('다중 가족 소속 유저는 푸시를 1회만 받지만 DB 알림은 가족별로 생성된다', async () => {
    mockDQFindMany.mockResolvedValue([
      { id: 'dq-A', questionId: 'q-A', familyId: 'fam-A', date: new Date('2026-04-17') },
      { id: 'dq-B', questionId: 'q-B', familyId: 'fam-B', date: new Date('2026-04-17') },
    ]);
    mockMembershipFindMany.mockResolvedValue([
      { userId: 'user-1', familyId: 'fam-A', skippedDate: null, user: mockUser },
      { userId: 'user-1', familyId: 'fam-B', skippedDate: null, user: mockUser },
    ]);
    mockAnswerFindMany.mockResolvedValue([]);

    await sendDailyReminders();

    expect(mockCreateNotification).toHaveBeenCalledTimes(2);
    expect(mockSendApnsPush).toHaveBeenCalledTimes(1);
  });

  it('notifQuestion=false 유저에게는 푸시를 발송하지 않는다 (DB 알림은 저장)', async () => {
    mockDQFindMany.mockResolvedValue([
      { id: 'dq-1', questionId: 'q-1', familyId: 'fam-1', date: new Date('2026-04-17') },
    ]);
    mockMembershipFindMany.mockResolvedValue([
      {
        userId: 'user-1',
        familyId: 'fam-1',
        skippedDate: null,
        user: { ...mockUser, notifQuestion: false },
      },
    ]);
    mockAnswerFindMany.mockResolvedValue([]);

    await sendDailyReminders();

    expect(mockCreateNotification).toHaveBeenCalledTimes(1);
    expect(mockSendApnsPush).not.toHaveBeenCalled();
  });

  it('FCM 토큰만 있는 유저에게는 FCM 푸시만 발송된다', async () => {
    mockDQFindMany.mockResolvedValue([
      { id: 'dq-1', questionId: 'q-1', familyId: 'fam-1', date: new Date('2026-04-17') },
    ]);
    mockMembershipFindMany.mockResolvedValue([
      {
        userId: 'user-1',
        familyId: 'fam-1',
        skippedDate: null,
        user: { ...mockUser, apnsToken: null, fcmToken: 'fcm-token' },
      },
    ]);
    mockAnswerFindMany.mockResolvedValue([]);

    await sendDailyReminders();

    expect(mockSendApnsPush).not.toHaveBeenCalled();
    expect(mockSendFcmPush).toHaveBeenCalledTimes(1);
  });

  it('가족 멤버 중 일부만 답변했으면 미답변 멤버만 대상이 된다', async () => {
    const otherUser = { ...mockUser, id: 'user-2' };
    mockDQFindMany.mockResolvedValue([
      { id: 'dq-1', questionId: 'q-1', familyId: 'fam-1', date: new Date('2026-04-17') },
    ]);
    mockMembershipFindMany.mockResolvedValue([
      { userId: 'user-1', familyId: 'fam-1', skippedDate: null, user: mockUser },
      { userId: 'user-2', familyId: 'fam-1', skippedDate: null, user: otherUser },
    ]);
    mockAnswerFindMany.mockResolvedValue([{ questionId: 'q-1', userId: 'user-1' }]);

    await sendDailyReminders();

    // user-2(미답변)에게 ANSWER_REQUEST 1건 + user-1(답변자)에게 ANSWERER_NUDGE 1건 = 총 2건
    expect(mockCreateNotification).toHaveBeenCalledTimes(2);
    expect(mockCreateNotification).toHaveBeenCalledWith(
      'user-2',
      'ANSWER_REQUEST',
      expect.any(String),
      expect.any(String),
      'fam-1'
    );
    expect(mockCreateNotification).toHaveBeenCalledWith(
      'user-1',
      'ANSWERER_NUDGE',
      expect.any(String),
      expect.any(String),
      'fam-1'
    );
  });
});

describe('sendDailyReminders - answerer nudge (MG-12)', () => {
  it('본인 답변 + 가족 1명 미답변 → 답변자에게 ANSWERER_NUDGE DB/푸시 1회', async () => {
    const otherUser = { ...mockUser, id: 'user-2', apnsToken: 'apns-2' };
    mockDQFindMany.mockResolvedValue([
      { id: 'dq-1', questionId: 'q-1', familyId: 'fam-1', date: new Date('2026-04-17') },
    ]);
    mockMembershipFindMany.mockResolvedValue([
      { userId: 'user-1', familyId: 'fam-1', skippedDate: null, user: mockUser },
      { userId: 'user-2', familyId: 'fam-1', skippedDate: null, user: otherUser },
    ]);
    mockAnswerFindMany.mockResolvedValue([{ questionId: 'q-1', userId: 'user-1' }]);

    await sendDailyReminders();

    const nudgeCalls = mockCreateNotification.mock.calls.filter(
      (c) => c[1] === 'ANSWERER_NUDGE'
    );
    expect(nudgeCalls).toHaveLength(1);
    expect(nudgeCalls[0][0]).toBe('user-1');
    // body 에 "1명" 포함 (pendingCount=1)
    expect(nudgeCalls[0][3]).toContain('1명');

    // APNs 푸시: user-1(답변자) + user-2(미답변) 각 1회 = 2회
    expect(mockSendApnsPush).toHaveBeenCalledTimes(2);
    const apnsCallsAnswerer = mockSendApnsPush.mock.calls.filter(
      (c) => c[3] === 'ANSWERER_NUDGE'
    );
    expect(apnsCallsAnswerer).toHaveLength(1);
  });

  it('전원 답변 완료 → 답변자 재촉 발송 안 함', async () => {
    const otherUser = { ...mockUser, id: 'user-2' };
    mockDQFindMany.mockResolvedValue([
      { id: 'dq-1', questionId: 'q-1', familyId: 'fam-1', date: new Date('2026-04-17') },
    ]);
    mockMembershipFindMany.mockResolvedValue([
      { userId: 'user-1', familyId: 'fam-1', skippedDate: null, user: mockUser },
      { userId: 'user-2', familyId: 'fam-1', skippedDate: null, user: otherUser },
    ]);
    mockAnswerFindMany.mockResolvedValue([
      { questionId: 'q-1', userId: 'user-1' },
      { questionId: 'q-1', userId: 'user-2' },
    ]);

    await sendDailyReminders();

    const nudgeCalls = mockCreateNotification.mock.calls.filter(
      (c) => c[1] === 'ANSWERER_NUDGE'
    );
    expect(nudgeCalls).toHaveLength(0);
  });

  it('1인 가족 → 답변자 재촉 발송 안 함 (멤버십 1명 스킵)', async () => {
    mockDQFindMany.mockResolvedValue([
      { id: 'dq-1', questionId: 'q-1', familyId: 'fam-1', date: new Date('2026-04-17') },
    ]);
    mockMembershipFindMany.mockResolvedValue([
      { userId: 'user-1', familyId: 'fam-1', skippedDate: null, user: mockUser },
    ]);
    mockAnswerFindMany.mockResolvedValue([{ questionId: 'q-1', userId: 'user-1' }]);

    await sendDailyReminders();

    const nudgeCalls = mockCreateNotification.mock.calls.filter(
      (c) => c[1] === 'ANSWERER_NUDGE'
    );
    expect(nudgeCalls).toHaveLength(0);
  });

  it('notifAnswererNudge=false 유저는 푸시 제외 (DB 알림은 저장)', async () => {
    const optedOutUser = { ...mockUser, notifAnswererNudge: false };
    const otherUser = { ...mockUser, id: 'user-2', apnsToken: 'apns-2' };
    mockDQFindMany.mockResolvedValue([
      { id: 'dq-1', questionId: 'q-1', familyId: 'fam-1', date: new Date('2026-04-17') },
    ]);
    mockMembershipFindMany.mockResolvedValue([
      { userId: 'user-1', familyId: 'fam-1', skippedDate: null, user: optedOutUser },
      { userId: 'user-2', familyId: 'fam-1', skippedDate: null, user: otherUser },
    ]);
    mockAnswerFindMany.mockResolvedValue([{ questionId: 'q-1', userId: 'user-1' }]);

    await sendDailyReminders();

    const nudgeDb = mockCreateNotification.mock.calls.filter(
      (c) => c[1] === 'ANSWERER_NUDGE'
    );
    expect(nudgeDb).toHaveLength(1); // DB 알림은 저장

    const nudgeApns = mockSendApnsPush.mock.calls.filter(
      (c) => c[3] === 'ANSWERER_NUDGE'
    );
    expect(nudgeApns).toHaveLength(0); // 푸시는 제외
  });

  it('4일 윈도우 밖 DQ(5일 전)는 답변자 재촉 대상에서 제외', async () => {
    const otherUser = { ...mockUser, id: 'user-2' };
    // 오늘 = now — mock 기준일 없음. REMINDER_WINDOW_DAYS=7 이므로 DQ 5일 전이 7일 윈도우엔 들어옴
    // 그러나 ANSWERER_NUDGE_WINDOW_DAYS=4 이므로 답변자 재촉 대상에선 빠져야 함
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    mockDQFindMany.mockResolvedValue([
      { id: 'dq-old', questionId: 'q-old', familyId: 'fam-1', date: fiveDaysAgo },
    ]);
    mockMembershipFindMany.mockResolvedValue([
      { userId: 'user-1', familyId: 'fam-1', skippedDate: null, user: mockUser },
      { userId: 'user-2', familyId: 'fam-1', skippedDate: null, user: otherUser },
    ]);
    mockAnswerFindMany.mockResolvedValue([{ questionId: 'q-old', userId: 'user-1' }]);

    await sendDailyReminders();

    const nudgeCalls = mockCreateNotification.mock.calls.filter(
      (c) => c[1] === 'ANSWERER_NUDGE'
    );
    expect(nudgeCalls).toHaveLength(0);
  });

  it('답변자가 복수 질문에서 가족 미답변 상태면 bodyMulti 문구 사용', async () => {
    const otherUser = { ...mockUser, id: 'user-2' };
    const today = new Date();
    const y1 = new Date(today.getTime() - 1 * 24 * 60 * 60 * 1000);
    const y2 = new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000);
    mockDQFindMany.mockResolvedValue([
      { id: 'dq-1', questionId: 'q-1', familyId: 'fam-1', date: today },
      { id: 'dq-2', questionId: 'q-2', familyId: 'fam-1', date: y1 },
      { id: 'dq-3', questionId: 'q-3', familyId: 'fam-1', date: y2 },
    ]);
    mockMembershipFindMany.mockResolvedValue([
      { userId: 'user-1', familyId: 'fam-1', skippedDate: null, user: mockUser },
      { userId: 'user-2', familyId: 'fam-1', skippedDate: null, user: otherUser },
    ]);
    mockAnswerFindMany.mockResolvedValue([
      { questionId: 'q-1', userId: 'user-1' },
      { questionId: 'q-2', userId: 'user-1' },
      { questionId: 'q-3', userId: 'user-1' },
    ]);

    await sendDailyReminders();

    const nudgeCalls = mockCreateNotification.mock.calls.filter(
      (c) => c[1] === 'ANSWERER_NUDGE'
    );
    expect(nudgeCalls).toHaveLength(1); // (user-1, fam-1) 단위 1건
    expect(nudgeCalls[0][3]).toContain('3개'); // 3개 질문
  });
});
