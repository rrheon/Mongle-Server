import prisma from '../utils/prisma';
import {
  CreateFamilyRequest,
  JoinFamilyRequest,
  FamilyResponse,
  FamilyMembersResponse,
  FamiliesListResponse,
  UserResponse,
} from '../models';
import { Errors } from '../middleware/errorHandler';
import { generateInviteCode, isValidInviteCode } from '../utils/inviteCode';
import { QuestionService } from './QuestionService';

function getKstToday(): Date {
  const now = new Date();
  const kstDateStr = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
  return new Date(kstDateStr + 'T00:00:00.000Z');
}

const MAX_GROUPS = 3;
const MAX_MEMBERS = 8; // MongleScene 수용 한계 기반 (collisionRadius=76pt, 유효 씬 면적 기준)

export class FamilyService {
  /**
   * 새 가족 생성
   */
  async createFamily(userId: string, data: CreateFamilyRequest): Promise<FamilyResponse> {
    const user = await prisma.user.findUnique({ where: { userId } });
    if (!user) throw Errors.notFound('사용자');

    // 최대 그룹 수 확인
    const membershipCount = await prisma.familyMembership.count({
      where: { userId: user.id },
    });
    if (membershipCount >= MAX_GROUPS) {
      throw Errors.conflict(`그룹은 최대 ${MAX_GROUPS}개까지 참여할 수 있습니다.`);
    }

    // 고유한 초대 코드 생성
    let inviteCode: string;
    let attempts = 0;
    do {
      inviteCode = generateInviteCode();
      const existing = await prisma.family.findUnique({ where: { inviteCode } });
      if (!existing) break;
      attempts++;
    } while (attempts < 10);

    if (attempts >= 10) throw Errors.internal('초대 코드 생성에 실패했습니다.');

    // 가족 생성 + 멤버십 등록 (트랜잭션)
    const family = await prisma.$transaction(async (tx) => {
      const newFamily = await tx.family.create({
        data: { name: data.name, inviteCode, createdById: user.id },
      });

      await tx.familyMembership.create({
        data: {
          userId: user.id,
          familyId: newFamily.id,
          role: data.creatorRole,
          nickname: data.nickname ?? null,
          colorId: data.colorId ?? 'loved',
          hearts: 5,
        },
      });

      // 현재 활성 가족 설정
      await tx.user.update({
        where: { id: user.id },
        data: { familyId: newFamily.id, role: data.creatorRole },
      });

      return newFamily;
    });

    // MG-16: 가입 즉시 첫 질문 발급 (스케줄러의 KST 11시 cron까지 기다리지 않음).
    // 트랜잭션 외부에서 호출 — 질문 풀 조회 등 부수효과가 있고, 실패해도 가족 생성은 성공해야 함.
    try {
      const questionService = new QuestionService();
      await questionService.assignQuestionToFamily(family.id, getKstToday());
    } catch (e) {
      console.warn('[FamilyService] 첫 질문 발급 실패 (다음 스케줄러 실행 시 자동 재시도):', e);
    }

    return this.getFamilyWithMembers(family.id);
  }

  /**
   * 초대 코드로 가족 참여
   */
  async joinFamily(userId: string, data: JoinFamilyRequest): Promise<FamilyResponse> {
    if (!isValidInviteCode(data.inviteCode)) {
      throw Errors.badRequest('유효하지 않은 초대 코드입니다.');
    }

    const user = await prisma.user.findUnique({ where: { userId } });
    if (!user) throw Errors.notFound('사용자');

    // 최대 그룹 수 확인
    const membershipCount = await prisma.familyMembership.count({
      where: { userId: user.id },
    });
    if (membershipCount >= MAX_GROUPS) {
      throw Errors.conflict(`그룹은 최대 ${MAX_GROUPS}개까지 참여할 수 있습니다.`);
    }

    // 초대 코드로 가족 조회
    const family = await prisma.family.findUnique({
      where: { inviteCode: data.inviteCode.toUpperCase() },
    });
    if (!family) throw Errors.notFound('그룹');

    // 이미 이 가족 멤버인지 확인
    const existing = await prisma.familyMembership.findUnique({
      where: { userId_familyId: { userId: user.id, familyId: family.id } },
    });
    if (existing) throw Errors.conflict('이미 해당 그룹에 속해 있습니다.');

    // 그룹 최대 인원 확인
    const currentMemberCount = await prisma.familyMembership.count({
      where: { familyId: family.id },
    });
    if (currentMemberCount >= MAX_MEMBERS) {
      throw Errors.conflict(`그룹 인원이 가득 찼습니다. 최대 ${MAX_MEMBERS}명까지 참여할 수 있습니다.`);
    }

    await prisma.$transaction(async (tx) => {
      await tx.familyMembership.create({
        data: {
          userId: user.id,
          familyId: family.id,
          role: data.role,
          nickname: data.nickname ?? null,
          colorId: data.colorId ?? 'loved',
          hearts: 5,
        },
      });

      // 현재 활성 가족 설정
      await tx.user.update({
        where: { id: user.id },
        data: { familyId: family.id, role: data.role },
      });
    });

    return this.getFamilyWithMembers(family.id);
  }

  /**
   * 내 가족 조회
   */
  async getMyFamily(userId: string): Promise<FamilyResponse | null> {
    const user = await prisma.user.findUnique({
      where: { userId },
    });

    if (!user || !user.familyId) {
      return null;
    }

    return this.getFamilyWithMembers(user.familyId);
  }

  /**
   * 가족 상세 조회 (권한 확인 포함)
   */
  async getFamily(userId: string, familyId: string): Promise<FamilyResponse> {
    const normalizedFamilyId = familyId.toLowerCase();
    const user = await prisma.user.findUnique({ where: { userId } });
    if (!user) throw Errors.notFound('사용자');

    const membership = await prisma.familyMembership.findUnique({
      where: { userId_familyId: { userId: user.id, familyId: normalizedFamilyId } },
    });
    if (!membership && user.familyId !== normalizedFamilyId) {
      throw Errors.forbidden('해당 그룹에 대한 접근 권한이 없습니다.');
    }

    return this.getFamilyWithMembers(normalizedFamilyId);
  }

  /**
   * 가족 구성원 목록
   */
  async getFamilyMembers(userId: string, familyId: string): Promise<FamilyMembersResponse> {
    const normalizedFamilyId = familyId.toLowerCase();
    const user = await prisma.user.findUnique({ where: { userId } });

    const membership = user
      ? await prisma.familyMembership.findUnique({
          where: { userId_familyId: { userId: user.id, familyId: normalizedFamilyId } },
        })
      : null;

    if (!user || (!membership && user.familyId !== normalizedFamilyId)) {
      throw Errors.forbidden('해당 그룹에 대한 접근 권한이 없습니다.');
    }

    const memberships = await prisma.familyMembership.findMany({
      where: { familyId: normalizedFamilyId },
      include: { user: true },
      orderBy: { joinedAt: 'asc' },
    });

    return { members: memberships.map((m) => this.toUserResponseFromMembership(m)) };
  }

  /**
   * 내 모든 가족 목록 조회
   */
  async getMyFamilies(userId: string): Promise<FamiliesListResponse> {
    const user = await prisma.user.findUnique({ where: { userId } });
    if (!user) throw Errors.notFound('사용자');

    const memberships = await prisma.familyMembership.findMany({
      where: { userId: user.id },
      include: {
        family: {
          include: {
            memberships: {
              include: { user: true },
              orderBy: { joinedAt: 'asc' },
            },
          },
        },
      },
      orderBy: { joinedAt: 'asc' },
    });

    const families = await Promise.all(
      memberships.map(async (m) => {
        const memberIds = m.family.memberships.map((fm) => fm.userId);
        const streakDays = await this.getFamilyStreakDays(m.family.id, memberIds);
        return {
          id: m.family.id,
          name: m.family.name,
          inviteCode: m.family.inviteCode,
          createdById: m.family.createdById,
          members: m.family.memberships.map((fm) => this.toUserResponseFromMembership(fm)),
          createdAt: m.family.createdAt,
          streakDays,
        };
      })
    );

    return { families };
  }

  /**
   * 그룹 연속기록 계산
   * 오늘(또는 어제)부터 소급하여 모든 멤버가 답변한 연속 날 수를 반환
   */
  private async getFamilyStreakDays(familyId: string, memberIds: string[]): Promise<number> {
    if (memberIds.length === 0) return 0;

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const sixtyDaysAgo = new Date(today);
    sixtyDaysAgo.setUTCDate(today.getUTCDate() - 60);

    const dailyQuestions = await prisma.dailyQuestion.findMany({
      where: {
        familyId,
        date: { gte: sixtyDaysAgo },
        isSkipped: false,
      },
      include: {
        question: {
          include: {
            answers: {
              where: { userId: { in: memberIds } },
              select: { userId: true },
            },
          },
        },
      },
      orderBy: { date: 'desc' },
    });

    // 날짜별 답변한 멤버 ID 집합 구성
    const dateAnswerMap = new Map<string, Set<string>>();
    for (const dq of dailyQuestions) {
      const dateStr = (dq.date as Date).toISOString().split('T')[0];
      const answeredIds = new Set(dq.question.answers.map((a) => a.userId));
      dateAnswerMap.set(dateStr, answeredIds);
    }

    const allMembersAnswered = (dateStr: string): boolean => {
      const answeredIds = dateAnswerMap.get(dateStr);
      if (!answeredIds) return false;
      return memberIds.every((id) => answeredIds.has(id));
    };

    const todayStr = today.toISOString().split('T')[0];
    const yesterday = new Date(today);
    yesterday.setUTCDate(today.getUTCDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    // 오늘 또는 어제 전원 답변 여부 확인
    const startStr = allMembersAnswered(todayStr)
      ? todayStr
      : allMembersAnswered(yesterdayStr)
      ? yesterdayStr
      : null;

    if (!startStr) return 0;

    // 시작일부터 과거로 연속 날 수 계산
    let streak = 0;
    const cursor = new Date(startStr + 'T00:00:00Z');
    while (true) {
      const cursorStr = cursor.toISOString().split('T')[0];
      if (!allMembersAnswered(cursorStr)) break;
      streak++;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }

    return streak;
  }

  /**
   * 활성 가족 전환
   */
  async selectFamily(userId: string, familyId: string): Promise<FamilyResponse> {
    const normalizedFamilyId = familyId.toLowerCase();
    const user = await prisma.user.findUnique({ where: { userId } });
    if (!user) throw Errors.notFound('사용자');

    const membership = await prisma.familyMembership.findUnique({
      where: { userId_familyId: { userId: user.id, familyId: normalizedFamilyId } },
    });
    if (!membership) throw Errors.forbidden('해당 그룹의 멤버가 아닙니다.');

    await prisma.user.update({
      where: { id: user.id },
      data: { familyId: normalizedFamilyId, role: membership.role },
    });

    return this.getFamilyWithMembers(normalizedFamilyId);
  }

  /**
   * 특정 가족 떠나기
   */
  async leaveFamily(userId: string, familyId?: string): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { userId },
      include: { family: true },
    });
    if (!user) throw Errors.notFound('사용자');

    const targetFamilyId = familyId ?? user.familyId;
    if (!targetFamilyId) throw Errors.badRequest('그룹에 속해 있지 않습니다.');

    const family = await prisma.family.findUnique({ where: { id: targetFamilyId } });

    // 가족 생성자인 경우
    if (family?.createdById === user.id) {
      // 그룹 생성 후 3일(72시간) 이내에는 그룹 삭제 불가 (반복 생성/삭제 방지)
      // 위임 후 나가기(일반 멤버)는 이 제한에 해당하지 않음
      const hoursSinceCreation = family
        ? (Date.now() - family.createdAt.getTime()) / (1000 * 60 * 60)
        : 72;
      if (hoursSinceCreation < 72) {
        const daysLeft = Math.ceil((72 - hoursSinceCreation) / 24);
        throw Errors.forbidden(`그룹 생성 후 3일이 지나야 그룹을 해제할 수 있습니다. (${daysLeft}일 후 가능)`);
      }
      const memberCount = await prisma.familyMembership.count({
        where: { familyId: targetFamilyId },
      });

      if (memberCount > 1) {
        // 다른 멤버가 있으면 위임 후 나가야 함
        throw Errors.forbidden('그룹 생성자는 그룹을 떠날 수 없습니다.');
      }

      // 혼자인 경우: 가족 자체를 삭제
      await prisma.$transaction(async (tx) => {
        await tx.familyMembership.deleteMany({ where: { familyId: targetFamilyId } });
        await tx.dailyQuestion.deleteMany({ where: { familyId: targetFamilyId } });
        await tx.family.delete({ where: { id: targetFamilyId } });
        await tx.user.update({
          where: { id: user.id },
          data: { familyId: null, role: 'OTHER' },
        });
      });
      return;
    }

    await prisma.$transaction(async (tx) => {
      // 멤버십 삭제
      await tx.familyMembership.deleteMany({
        where: { userId: user.id, familyId: targetFamilyId },
      });

      // 현재 활성 가족이었으면 다른 가족으로 전환
      if (user.familyId === targetFamilyId) {
        const nextMembership = await tx.familyMembership.findFirst({
          where: { userId: user.id, familyId: { not: targetFamilyId } },
          orderBy: { joinedAt: 'asc' },
        });
        await tx.user.update({
          where: { id: user.id },
          data: {
            familyId: nextMembership?.familyId ?? null,
            role: nextMembership?.role ?? 'OTHER',
          },
        });
      }
    });
  }


  /**
   * 방장 위임 — 현재 방장이 다른 멤버에게 방장 권한을 넘김
   */
  async transferCreator(userId: string, newCreatorId: string): Promise<void> {
    // UUID 대소문자 정규화 (iOS는 대문자 UUID를 전송)
    const normalizedNewCreatorId = newCreatorId.toLowerCase();

    const user = await prisma.user.findUnique({ where: { userId } });
    if (!user || !user.familyId) throw Errors.badRequest('그룹에 속해 있지 않습니다.');

    const family = await prisma.family.findUnique({ where: { id: user.familyId } });
    if (!family) throw Errors.notFound('그룹');
    if (family.createdById !== user.id) throw Errors.forbidden('방장만 위임할 수 있습니다.');
    if (normalizedNewCreatorId === user.id) throw Errors.badRequest('자기 자신에게 위임할 수 없습니다.');

    const newCreatorMembership = await prisma.familyMembership.findUnique({
      where: { userId_familyId: { userId: normalizedNewCreatorId, familyId: user.familyId } },
    });
    if (!newCreatorMembership) throw Errors.notFound('대상 구성원');

    await prisma.family.update({
      where: { id: user.familyId },
      data: { createdById: normalizedNewCreatorId },
    });
  }

  /**
   * 방장이 가족 구성원을 내보내기
   */
  async kickMember(adminUserId: string, targetMemberId: string): Promise<void> {
    // UUID 대소문자 정규화 (iOS는 대문자 UUID를 전송)
    const normalizedTargetId = targetMemberId.toLowerCase();

    const admin = await prisma.user.findUnique({
      where: { userId: adminUserId },
      include: { family: true },
    });

    if (!admin || !admin.familyId) throw Errors.badRequest('그룹에 속해 있지 않습니다.');

    const familyId = admin.familyId;

    // 방장 여부 확인
    if (admin.family?.createdById !== admin.id) {
      throw Errors.forbidden('그룹 방장만 구성원을 내보낼 수 있습니다.');
    }

    // 자기 자신은 내보낼 수 없음
    if (normalizedTargetId === admin.id) throw Errors.badRequest('자기 자신을 내보낼 수 없습니다.');

    // FamilyMembership 기준으로 대상 구성원 확인
    const targetMembership = await prisma.familyMembership.findUnique({
      where: { userId_familyId: { userId: normalizedTargetId, familyId } },
      include: { user: true },
    });
    if (!targetMembership) throw Errors.notFound('대상 그룹 구성원');

    await prisma.$transaction(async (tx) => {
      // FamilyMembership 레코드 삭제
      await tx.familyMembership.delete({
        where: { userId_familyId: { userId: normalizedTargetId, familyId } },
      });

      // 대상 멤버의 활성 가족이 이 가족이었으면 다른 가족으로 전환
      if (targetMembership.user.familyId === familyId) {
        const nextMembership = await tx.familyMembership.findFirst({
          where: { userId: normalizedTargetId, familyId: { not: familyId } },
          orderBy: { joinedAt: 'asc' },
        });
        await tx.user.update({
          where: { id: normalizedTargetId },
          data: {
            familyId: nextMembership?.familyId ?? null,
            role: nextMembership?.role ?? 'OTHER',
          },
        });
      }
    });
  }

  /**
   * 가족 + 구성원 조회 (FamilyMembership 기준 — 현재 활성 가족 상관없이 모든 멤버 반환)
   */
  private async getFamilyWithMembers(familyId: string): Promise<FamilyResponse> {
    const family = await prisma.family.findUnique({
      where: { id: familyId },
      include: {
        memberships: {
          include: { user: true },
          orderBy: { joinedAt: 'asc' },
        },
      },
    });

    if (!family) {
      throw Errors.notFound('그룹');
    }

    const memberIds = family.memberships.map((m) => m.userId);
    const streakDays = await this.getFamilyStreakDays(family.id, memberIds);

    return {
      id: family.id,
      name: family.name,
      inviteCode: family.inviteCode,
      createdById: family.createdById,
      members: family.memberships.map((m) => this.toUserResponseFromMembership(m)),
      createdAt: family.createdAt,
      streakDays,
    };
  }

  /**
   * FamilyMembership 기반 UserResponse — 그룹별 nickname, colorId, hearts 사용
   */
  private toUserResponseFromMembership(membership: {
    nickname: string | null;
    colorId: string | null;
    hearts: number;
    role: string;
    user: {
      id: string;
      email: string;
      name: string;
      profileImageUrl: string | null;
      familyId: string | null;
      moodId?: string | null;
      createdAt: Date;
    };
  }): UserResponse {
    return {
      id: membership.user.id,
      email: membership.user.email,
      name: membership.nickname ?? membership.user.name, // 그룹별 닉네임 우선
      profileImageUrl: membership.user.profileImageUrl,
      role: membership.role as UserResponse['role'],
      familyId: membership.user.familyId,
      hearts: membership.hearts, // 그룹별 하트
      moodId: membership.colorId ?? membership.user.moodId ?? null, // 그룹별 색상 우선
      createdAt: membership.user.createdAt,
    };
  }

  private toUserResponse(user: {
    id: string;
    email: string;
    name: string;
    profileImageUrl: string | null;
    role: string;
    familyId: string | null;
    hearts: number;
    moodId?: string | null;
    createdAt: Date;
  }): UserResponse {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      profileImageUrl: user.profileImageUrl,
      role: user.role as UserResponse['role'],
      familyId: user.familyId,
      hearts: user.hearts,
      moodId: user.moodId ?? null,
      createdAt: user.createdAt,
    };
  }
}
