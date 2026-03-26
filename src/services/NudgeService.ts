import prisma from '../utils/prisma';
import { Errors } from '../middleware/errorHandler';
import { NotificationService } from './NotificationService';
import { PushNotificationService } from './PushNotificationService';

const notificationService = new NotificationService();
const pushService = new PushNotificationService();

export class NudgeService {
  /**
   * 재촉하기 — 하트 1개 차감 + 대상 유저에게 알림 (푸시 인프라 준비 전까지 DB 기록만)
   */
  async sendNudge(senderUserId: string, targetUserId: string): Promise<{ message: string; heartsRemaining: number }> {
    const sender = await prisma.user.findUnique({ where: { userId: senderUserId } });
    if (!sender) throw Errors.notFound('사용자');
    if (!sender.familyId) throw Errors.badRequest('가족에 속해 있지 않습니다.');

    // 하트 잔액 확인 (1개 이상 필요 — FamilyMembership 기준)
    const senderMembership = await prisma.familyMembership.findUnique({
      where: { userId_familyId: { userId: sender.id, familyId: sender.familyId } },
    });
    const currentHearts = senderMembership?.hearts ?? 0;
    if (currentHearts < 1) {
      throw Errors.badRequest('하트가 부족합니다. 재촉하기에는 하트 1개가 필요합니다.');
    }

    // 대상 유저 확인 (같은 가족인지) — FamilyMembership 기준으로 확인
    // User.familyId(활성 가족)가 달라도 같은 그룹 멤버일 수 있으므로 Membership 테이블로 검색
    const targetMembership = await prisma.familyMembership.findUnique({
      where: {
        userId_familyId: {
          userId: targetUserId.toLowerCase(),
          familyId: sender.familyId,
        },
      },
      include: { user: true },
    });
    if (!targetMembership) throw Errors.notFound('대상 가족 구성원');
    const target = targetMembership.user;

    // 자기 자신에게 재촉 불가
    if (target.userId === senderUserId) {
      throw Errors.badRequest('자기 자신에게 재촉할 수 없습니다.');
    }

    // 하트 차감 (FamilyMembership 기준)
    await prisma.familyMembership.updateMany({
      where: { userId: sender.id, familyId: sender.familyId },
      data: { hearts: { decrement: 1 } },
    });

    const updatedMembership = await prisma.familyMembership.findUnique({
      where: { userId_familyId: { userId: sender.id, familyId: sender.familyId } },
    });

    // 재촉 알림 DB 저장 (대상 유저 알림함에 노출)
    await notificationService.createNotification(
      target.id,
      'ANSWER_REQUEST',
      `${sender.name}님이 답변을 재촉했어요!`,
      '오늘의 질문에 아직 답변하지 않았어요. 지금 바로 답변해보세요 🌿',
      sender.familyId ?? undefined
    );

    // APNs 실시간 푸시 발송 (토큰이 있는 경우만, 실패해도 전체 요청 영향 없음)
    if (target.apnsToken) {
      pushService.sendNudgePush(target.apnsToken, sender.name).catch(() => {});
    }

    return {
      message: `${target.name}에게 재촉 알림을 보냈습니다.`,
      heartsRemaining: updatedMembership?.hearts ?? 0,
    };
  }
}
