import { UserService } from './UserService';

/**
 * 스테이지 정의 (PRD §2.2 확정).
 *
 * streak → stage 매핑:
 *   0~2   → 0 (SEED,    1.00)
 *   3~6   → 1 (SPROUT,  1.10)
 *   7~13  → 2 (LEAF,    1.20)
 *   14~29 → 3 (BUD,     1.32)
 *   30~99 → 4 (BLOOM,   1.45)
 *   100+  → 5 (RADIANCE,1.60)
 */
export interface CharacterStageDefinition {
  stage: number;
  stageKey: 'SEED' | 'SPROUT' | 'LEAF' | 'BUD' | 'BLOOM' | 'RADIANCE';
  minStreak: number;
  sizeMultiplier: number;
}

const STAGES: CharacterStageDefinition[] = [
  { stage: 0, stageKey: 'SEED',     minStreak: 0,   sizeMultiplier: 1.0  },
  { stage: 1, stageKey: 'SPROUT',   minStreak: 3,   sizeMultiplier: 1.1  },
  { stage: 2, stageKey: 'LEAF',     minStreak: 7,   sizeMultiplier: 1.2  },
  { stage: 3, stageKey: 'BUD',      minStreak: 14,  sizeMultiplier: 1.32 },
  { stage: 4, stageKey: 'BLOOM',    minStreak: 30,  sizeMultiplier: 1.45 },
  { stage: 5, stageKey: 'RADIANCE', minStreak: 100, sizeMultiplier: 1.6  },
];

export interface CharacterStageResult {
  stage: number;
  stageKey: CharacterStageDefinition['stageKey'];
  streakDays: number;
  /** 다음 단계까지의 필요 streak. 최종 단계면 null. */
  nextStageStreak: number | null;
  sizeMultiplier: number;
}

/** 순수 함수: streak 정수 → 스테이지. 테스트 가능. */
export function resolveStage(streakDays: number): CharacterStageResult {
  const safeStreak = Math.max(0, Math.floor(streakDays));
  let current = STAGES[0];
  for (const s of STAGES) {
    if (safeStreak >= s.minStreak) current = s;
    else break;
  }
  const next = STAGES.find((s) => s.stage === current.stage + 1) ?? null;
  return {
    stage: current.stage,
    stageKey: current.stageKey,
    streakDays: safeStreak,
    nextStageStreak: next ? next.minStreak : null,
    sizeMultiplier: current.sizeMultiplier,
  };
}

export class CharacterStageService {
  private userService = new UserService();

  async getForUser(authUserId: string): Promise<CharacterStageResult> {
    const streak = await this.userService.getStreak(authUserId);
    return resolveStage(streak);
  }
}
