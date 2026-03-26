import prisma from '../utils/prisma';
import {
  CreateAnswerRequest,
  UpdateAnswerRequest,
  AnswerResponse,
  FamilyAnswersResponse,
  UserResponse,
} from '../models';
import { Errors } from '../middleware/errorHandler';

export class AnswerService {

  /**
   * 답변 작성
   */
  async createAnswer(userId: string, data: CreateAnswerRequest): Promise<AnswerResponse> {
    const user = await prisma.user.findUnique({
      where: { userId },
    });

    if (!user) {
      throw Errors.notFound('사용자');
    }

    // 질문 존재 확인 — iOS는 UUID를 대문자로 전송하므로 소문자로 정규화
    const normalizedQuestionId = data.questionId.toLowerCase();
    const question = await prisma.question.findUnique({
      where: { id: normalizedQuestionId },
    });

    if (!question) {
      throw Errors.notFound('질문');
    }

    // 이미 답변했는지 확인
    const existingAnswer = await prisma.answer.findUnique({
      where: {
        userId_questionId: {
          userId: user.id,
          questionId: normalizedQuestionId,
        },
      },
    });

    if (existingAnswer) {
      throw Errors.conflict('이미 이 질문에 답변했습니다.');
    }

    // 답변 생성
    const answer = await prisma.answer.create({
      data: {
        content: data.content,
        imageUrl: data.imageUrl,
        moodId: data.moodId,
        userId: user.id,
        questionId: normalizedQuestionId,
      },
      include: { user: true },
    });

    // 하트 +1, 답변 시 선택한 캐릭터 색상(moodId) 저장 (FamilyMembership 기준)
    if (user.familyId) {
      await prisma.familyMembership.updateMany({
        where: { userId: user.id, familyId: user.familyId },
        data: {
          hearts: { increment: 1 },
          ...(data.moodId && { colorId: data.moodId }),
        },
      });
    }

    return this.toAnswerResponse(answer);
  }

  /**
   * 내 답변 조회
   */
  async getMyAnswer(userId: string, questionId: string): Promise<AnswerResponse | null> {
    const user = await prisma.user.findUnique({
      where: { userId },
    });

    if (!user) {
      throw Errors.notFound('사용자');
    }

    const answer = await prisma.answer.findUnique({
      where: {
        userId_questionId: {
          userId: user.id,
          questionId: questionId.toLowerCase(),
        },
      },
      include: { user: true },
    });

    if (!answer) {
      return null;
    }

    return this.toAnswerResponse(answer);
  }

  /**
   * 가족 답변 목록 조회
   */
  async getFamilyAnswers(userId: string, questionId: string): Promise<FamilyAnswersResponse> {
    const user = await prisma.user.findUnique({
      where: { userId },
    });

    if (!user) {
      throw Errors.notFound('사용자');
    }

    if (!user.familyId) {
      return {
        answers: [],
        totalCount: 0,
        myAnswer: null,
      };
    }

    // 가족 멤버 닉네임 및 캐릭터 색상 맵 구성
    const memberships = await prisma.familyMembership.findMany({
      where: { familyId: user.familyId },
      select: { userId: true, nickname: true, colorId: true, user: { select: { name: true, moodId: true } } },
    });
    const nicknameMap = new Map(
      memberships.map((m) => [m.userId, m.nickname ?? m.user.name])
    );
    const colorMap = new Map(
      memberships.map((m) => [m.userId, m.colorId ?? m.user.moodId ?? 'loved'])
    );

    // 가족 구성원들의 답변 조회
    const answers = await prisma.answer.findMany({
      where: {
        questionId: questionId.toLowerCase(),
        user: {
          familyId: user.familyId,
        },
      },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });

    const myAnswer = answers.find((a) => a.userId === user.id);

    return {
      answers: answers.map((a) => this.toAnswerResponse(a, nicknameMap, colorMap)),
      totalCount: answers.length,
      myAnswer: myAnswer ? this.toAnswerResponse(myAnswer, nicknameMap, colorMap) : null,
    };
  }

  /**
   * 답변 수정
   */
  async updateAnswer(
    userId: string,
    answerId: string,
    data: UpdateAnswerRequest
  ): Promise<AnswerResponse> {
    const user = await prisma.user.findUnique({
      where: { userId },
    });

    if (!user) {
      throw Errors.notFound('사용자');
    }

    const normalizedAnswerId = answerId.toLowerCase();
    const answer = await prisma.answer.findUnique({
      where: { id: normalizedAnswerId },
    });

    if (!answer) {
      throw Errors.notFound('답변');
    }

    if (answer.userId !== user.id) {
      throw Errors.forbidden('본인의 답변만 수정할 수 있습니다.');
    }

    const updated = await prisma.answer.update({
      where: { id: normalizedAnswerId },
      data: {
        ...(data.content !== undefined && { content: data.content }),
        ...(data.imageUrl !== undefined && { imageUrl: data.imageUrl }),
        ...(data.moodId !== undefined && { moodId: data.moodId }),
      },
      include: { user: true },
    });

    // 수정 시 선택한 캐릭터 색상(moodId)을 FamilyMembership에도 반영
    if (data.moodId && user.familyId) {
      await prisma.familyMembership.updateMany({
        where: { userId: user.id, familyId: user.familyId },
        data: { colorId: data.moodId },
      });
    }

    return this.toAnswerResponse(updated);
  }

  /**
   * 답변 삭제
   */
  async deleteAnswer(userId: string, answerId: string): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { userId },
    });

    if (!user) {
      throw Errors.notFound('사용자');
    }

    const normalizedDeleteId = answerId.toLowerCase();
    const answer = await prisma.answer.findUnique({
      where: { id: normalizedDeleteId },
    });

    if (!answer) {
      throw Errors.notFound('답변');
    }

    if (answer.userId !== user.id) {
      throw Errors.forbidden('본인의 답변만 삭제할 수 있습니다.');
    }

    await prisma.answer.delete({
      where: { id: normalizedDeleteId },
    });

  }

  private toAnswerResponse(
    answer: {
      id: string;
      content: string;
      imageUrl: string | null;
      moodId?: string | null;
      questionId: string;
      createdAt: Date;
      updatedAt: Date;
      user: {
        id: string;
        email: string;
        name: string;
        profileImageUrl: string | null;
        role: string;
        familyId: string | null;
        hearts: number;
        moodId?: string | null;
        createdAt: Date;
      };
    },
    nicknameMap?: Map<string, string>,
    colorMap?: Map<string, string>
  ): AnswerResponse {
    // 답변 자체의 moodId 우선, 없으면 사용자의 현재 colorId
    const resolvedMoodId = answer.moodId ?? colorMap?.get(answer.user.id) ?? answer.user.moodId ?? null;
    return {
      id: answer.id,
      content: answer.content,
      imageUrl: answer.imageUrl,
      questionId: answer.questionId,
      createdAt: answer.createdAt,
      updatedAt: answer.updatedAt,
      user: {
        id: answer.user.id,
        email: answer.user.email,
        name: nicknameMap?.get(answer.user.id) ?? answer.user.name,
        profileImageUrl: answer.user.profileImageUrl,
        role: answer.user.role as UserResponse['role'],
        familyId: answer.user.familyId,
        hearts: answer.user.hearts,
        moodId: resolvedMoodId,
        createdAt: answer.user.createdAt,
      },
    };
  }
}
