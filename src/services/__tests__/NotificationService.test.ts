// mock-prefix 변수는 jest.mock factory에서 참조 가능 (ts-jest 호이스팅 규칙)
const mockUserFindUnique = jest.fn();
const mockNotificationFindMany = jest.fn();
const mockNotificationUpdateMany = jest.fn();
const mockNotificationDeleteMany = jest.fn();
const mockNotificationFindUniqueOrThrow = jest.fn();

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    user: { findUnique: mockUserFindUnique },
    notification: {
      findMany: mockNotificationFindMany,
      updateMany: mockNotificationUpdateMany,
      deleteMany: mockNotificationDeleteMany,
      findUniqueOrThrow: mockNotificationFindUniqueOrThrow,
    },
  })),
  NotificationType: {
    NUDGE: 'NUDGE',
    ANSWER: 'ANSWER',
    JOIN: 'JOIN',
    DAILY_QUESTION: 'DAILY_QUESTION',
    NUDGE_REMINDER: 'NUDGE_REMINDER',
  },
}));

import { NotificationService } from '../NotificationService';

const service = new NotificationService();

const mockUser = { id: 'user-uuid-1', userId: 'kakao:111' };
const mockNotif = {
  id: 'notif-1',
  userId: 'user-uuid-1',
  familyId: null,
  type: 'NUDGE',
  title: '알림 제목',
  body: '알림 내용',
  isRead: false,
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

describe('NotificationService.getNotifications', () => {
  it('유저가 없으면 빈 배열을 반환한다', async () => {
    mockUserFindUnique.mockResolvedValue(null);
    const result = await service.getNotifications('unknown-user');
    expect(result).toEqual([]);
  });

  it('유저의 알림 목록을 반환한다', async () => {
    mockUserFindUnique.mockResolvedValue(mockUser);
    mockNotificationFindMany.mockResolvedValue([mockNotif]);

    const result = await service.getNotifications('kakao:111');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('notif-1');
    expect(result[0].isRead).toBe(false);
  });

  it('limit 파라미터가 findMany에 전달된다', async () => {
    mockUserFindUnique.mockResolvedValue(mockUser);
    mockNotificationFindMany.mockResolvedValue([]);

    await service.getNotifications('kakao:111', 10);
    expect(mockNotificationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10 })
    );
  });

  it('createdAt 내림차순으로 조회한다', async () => {
    mockUserFindUnique.mockResolvedValue(mockUser);
    mockNotificationFindMany.mockResolvedValue([]);

    await service.getNotifications('kakao:111');
    expect(mockNotificationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'desc' } })
    );
  });
});

describe('NotificationService.markAsRead', () => {
  it('유저가 없으면 에러를 던진다', async () => {
    mockUserFindUnique.mockResolvedValue(null);
    await expect(service.markAsRead('unknown', 'notif-1')).rejects.toThrow('사용자를 찾을 수 없습니다.');
  });

  it('알림이 없으면 에러를 던진다', async () => {
    mockUserFindUnique.mockResolvedValue(mockUser);
    mockNotificationUpdateMany.mockResolvedValue({ count: 0 });
    await expect(service.markAsRead('kakao:111', 'notif-1')).rejects.toThrow('알림을 찾을 수 없습니다.');
  });

  it('알림을 읽음 처리하고 반환한다', async () => {
    mockUserFindUnique.mockResolvedValue(mockUser);
    mockNotificationUpdateMany.mockResolvedValue({ count: 1 });
    mockNotificationFindUniqueOrThrow.mockResolvedValue({ ...mockNotif, isRead: true });

    const result = await service.markAsRead('kakao:111', 'notif-1');
    expect(result.isRead).toBe(true);
    expect(mockNotificationUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isRead: true } })
    );
  });
});

describe('NotificationService.markAllAsRead', () => {
  it('유저가 없으면 { count: 0 }을 반환한다', async () => {
    mockUserFindUnique.mockResolvedValue(null);
    const result = await service.markAllAsRead('unknown');
    expect(result).toEqual({ count: 0 });
  });

  it('해당 유저의 미읽음 알림을 모두 읽음 처리한다', async () => {
    mockUserFindUnique.mockResolvedValue(mockUser);
    mockNotificationUpdateMany.mockResolvedValue({ count: 3 });

    const result = await service.markAllAsRead('kakao:111');
    expect(result.count).toBe(3);
    expect(mockNotificationUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: mockUser.id, isRead: false },
        data: { isRead: true },
      })
    );
  });
});

describe('NotificationService.deleteNotification', () => {
  it('유저가 없으면 에러를 던진다', async () => {
    mockUserFindUnique.mockResolvedValue(null);
    await expect(service.deleteNotification('unknown', 'notif-1')).rejects.toThrow();
  });

  it('해당 유저의 알림을 삭제한다', async () => {
    mockUserFindUnique.mockResolvedValue(mockUser);
    mockNotificationDeleteMany.mockResolvedValue({ count: 1 });

    await service.deleteNotification('kakao:111', 'notif-1');
    expect(mockNotificationDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'notif-1', userId: mockUser.id },
      })
    );
  });
});

describe('NotificationService.deleteAllNotifications', () => {
  it('유저가 없으면 { count: 0 }을 반환한다', async () => {
    mockUserFindUnique.mockResolvedValue(null);
    const result = await service.deleteAllNotifications('unknown');
    expect(result).toEqual({ count: 0 });
  });

  it('해당 유저의 모든 알림을 삭제하고 건수를 반환한다', async () => {
    mockUserFindUnique.mockResolvedValue(mockUser);
    mockNotificationDeleteMany.mockResolvedValue({ count: 5 });

    const result = await service.deleteAllNotifications('kakao:111');
    expect(result.count).toBe(5);
    expect(mockNotificationDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: mockUser.id } })
    );
  });

  it('다른 유저의 알림은 영향받지 않는다', async () => {
    mockUserFindUnique.mockResolvedValue(mockUser);
    mockNotificationDeleteMany.mockResolvedValue({ count: 2 });

    await service.deleteAllNotifications('kakao:111');
    // deleteMany는 userId 조건으로만 호출 → 다른 유저 알림은 건드리지 않음
    const callArgs = mockNotificationDeleteMany.mock.calls[0][0];
    expect(callArgs.where).toEqual({ userId: mockUser.id });
  });
});
