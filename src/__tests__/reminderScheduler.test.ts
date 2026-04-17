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

  it('동일 유저의 미답변 복수 건은 bodyMulti 문구로 취합된다', async () => {
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
    const body = mockCreateNotification.mock.calls[0][3] as string;
    expect(body).toContain('3건');
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

    expect(mockCreateNotification).toHaveBeenCalledTimes(1);
    expect(mockCreateNotification).toHaveBeenCalledWith(
      'user-2',
      'ANSWER_REQUEST',
      expect.any(String),
      expect.any(String),
      'fam-1'
    );
  });
});
