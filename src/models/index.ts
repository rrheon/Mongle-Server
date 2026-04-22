// ============================================
// Request/Response Models for API
// ============================================

// ============================================
// User
// ============================================
export type UserRole = 'FATHER' | 'MOTHER' | 'SON' | 'DAUGHTER' | 'OTHER';

export interface UserResponse {
  id: string;
  email: string;
  name: string;
  profileImageUrl: string | null;
  role: UserRole;
  familyId: string | null;
  hearts: number;
  moodId: string | null;
  createdAt: Date;
}

export interface UpdateUserRequest {
  name?: string;
  profileImageUrl?: string;
  role?: UserRole;
  moodId?: string;
}

export interface AdHeartRewardRequest {
  /** 광고 시청 보상으로 지급할 하트 수 (1 또는 3) */
  amount: number;
}

export interface HeartRewardResponse {
  heartsRemaining: number;
}

// ============================================
// Family
// ============================================
export interface CreateFamilyRequest {
  name: string;
  creatorRole: UserRole;
  nickname?: string; // 그룹별 닉네임
  colorId?: string;  // 그룹별 몽글 색상 (happy/calm/loved/sad/tired)
}

export interface JoinFamilyRequest {
  inviteCode: string;
  role: UserRole;
  nickname?: string; // 그룹별 닉네임
  colorId?: string;  // 그룹별 몽글 색상 (happy/calm/loved/sad/tired)
}

export interface TransferCreatorRequest {
  newCreatorId: string;
}

export interface FamilyResponse {
  id: string;
  name: string;
  inviteCode: string;
  createdById: string;
  members: UserResponse[];
  createdAt: Date;
  streakDays: number;
}

export interface FamilyMembersResponse {
  members: UserResponse[];
}

export interface FamiliesListResponse {
  families: FamilyResponse[];
}

// ============================================
// Question
// ============================================
export type QuestionCategory = 'DAILY' | 'MEMORY' | 'VALUE' | 'DREAM' | 'GRATITUDE' | 'SPECIAL';

export interface QuestionResponse {
  id: string;
  content: string;
  category: QuestionCategory;
  createdAt: Date;
  isCustom: boolean;
}

export interface DailyQuestionResponse {
  id: string;
  question: QuestionResponse;
  /**
   * 히스토리 노출일. 완료 전에는 배정일(assignedDate)과 동일,
   * 완료 후에는 completedAt(YYYY-MM-DD).
   */
  date: string;
  /** 질문 배정일 (YYYY-MM-DD). DQ 생성 시점 기준, 변하지 않음. */
  assignedDate?: string;
  /** 그룹 전원이 답변/패스 완료한 시각(ISO). 미완료면 null. */
  completedAt?: string | null;
  familyId: string;
  isSkipped: boolean;
  skippedAt: string | null;
  hasMyAnswer: boolean;
  hasMySkipped: boolean;
  familyAnswerCount: number;
  memberAnswerStatuses: MemberAnswerStatus[];
}

export interface SkipQuestionResponse {
  message: string;
  heartsRemaining: number;
}

export interface CreateCustomQuestionRequest {
  content: string;
}

export interface CreateCustomQuestionResponse {
  message: string;
  newQuestion: DailyQuestionResponse;
  heartsRemaining: number;
}

/** GET /questions 히스토리 응답 — 답변 목록 포함 (N+1 제거용) */
export interface HistoryAnswerSummary {
  id: string;
  userId: string;
  userName: string;
  content: string;
  imageUrl: string | null;
  moodId: string | null; // 그룹별 색상 (FamilyMembership.colorId 우선, 없으면 User.moodId)
}

export interface DailyQuestionHistoryResponse extends DailyQuestionResponse {
  answers: HistoryAnswerSummary[];
}

// ============================================
// Answer
// ============================================
export interface CreateAnswerRequest {
  questionId: string;
  content: string;
  imageUrl?: string;
  moodId?: string; // 답변 시 선택한 캐릭터 색상 (happy/calm/loved/sad/tired)
}

export interface UpdateAnswerRequest {
  content?: string;
  imageUrl?: string;
  moodId?: string;
}

export interface AnswerResponse {
  id: string;
  content: string;
  imageUrl: string | null;
  user: UserResponse;
  questionId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemberAnswerStatus {
  userId: string;
  userName: string;
  colorId: string;
  status: 'answered' | 'skipped' | 'not_answered';
}

export interface FamilyAnswersResponse {
  answers: AnswerResponse[];
  totalCount: number;
  myAnswer: AnswerResponse | null;
  memberStatuses: MemberAnswerStatus[];
}

// ============================================
// Common
// ============================================
export interface ErrorResponse {
  message: string;
  code: string;
  details?: Record<string, unknown>;
}

export interface PaginationQuery {
  page?: number;
  limit?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
