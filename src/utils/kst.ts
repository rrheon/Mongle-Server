/**
 * KST (UTC+9) 공통 날짜 헬퍼.
 *
 * Mongle 도메인은 "오늘"을 항상 KST 기준으로 본다. Lambda/RDS 가 UTC 인 환경에서
 * `new Date()` 의 getFullYear/getMonth 등을 그대로 쓰면 KST 0~8 시 사이 요청이
 * 하루 어긋나는 off-by-one 이 반복적으로 재발했다 (MoodService, scheduler 등).
 * 모든 KST 날짜 처리는 이 모듈을 통해야 한다.
 */

const KST_TZ = 'Asia/Seoul';

/**
 * KST 기준 "오늘" 을 UTC 자정으로 표현한 Date.
 * Prisma `@db.Date` 는 UTC 자정으로 저장되므로 비교/insert 에 안전.
 *
 * 주의: 시각 포함 DateTime (TIMESTAMP) 컬럼과의 cutoff 비교에는 쓰지 말 것.
 * 반환값 `2026-04-28T00:00:00.000Z` 는 실제로는 KST 04-28 09:00 시각이라
 * KST 0~9시 윈도우의 시각과 비교하면 9시간 어긋나 매번 미래로 보인다.
 * 그 용도엔 `getKstMidnightUtc()` 사용.
 */
export function getKstToday(): Date {
  const now = new Date();
  const kstDateStr = now.toLocaleDateString('en-CA', { timeZone: KST_TZ });
  return new Date(kstDateStr + 'T00:00:00.000Z');
}

/**
 * 현재 시각이 속한 KST 일자의 0시(자정)을 UTC Date 로 반환.
 *
 * 시각 포함 DateTime (Postgres TIMESTAMP) 컬럼과 cutoff 비교할 때 사용.
 * `getKstToday()` 는 `@db.Date` 호환을 위해 KST 날짜를 UTC 자정 시각으로 표기하므로
 * (예: KST 04-28 의도 → `2026-04-28T00:00:00.000Z` UTC = KST 09:00 시각)
 * TIMESTAMP cutoff 에 그대로 쓰면 KST 0~9시 사이에 매 비교가 항상 과거로 판정되는
 * off-by-9h 결함이 발생한다 (MG-81: 데일리 하트 매 호출 +1 버그).
 */
export function getKstMidnightUtc(): Date {
  const now = new Date();
  const kstDateStr = now.toLocaleDateString('en-CA', { timeZone: KST_TZ });
  return new Date(kstDateStr + 'T00:00:00.000+09:00');
}

/**
 * 임의 Date 를 KST "YYYY-MM-DD" 문자열로. 히스토리 노출일/UI key 용.
 */
export function toKstDateString(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: KST_TZ });
}

/**
 * KST 자정 정규화 — 문자열 또는 Date 입력을 받아 KST 자정 UTC 로 정규화.
 * MoodService 처럼 클라이언트가 `dateStr` 또는 임의 시각을 보낼 때 사용.
 */
export function toKstMidnight(input: string | Date): Date {
  const date = typeof input === 'string' ? new Date(input) : input;
  const kstDateStr = date.toLocaleDateString('en-CA', { timeZone: KST_TZ });
  return new Date(kstDateStr + 'T00:00:00.000Z');
}

/**
 * 두 날짜가 같은 KST 일자인지. UTC 기준으로 비교하면 KST 0~8 시 가 전날로
 * 잘못 묶이는 케이스가 있어 명시적 헬퍼 사용 권장.
 */
export function isSameKstDate(a: Date | null | undefined, b: Date | null | undefined): boolean {
  if (!a || !b) return false;
  return toKstDateString(a) === toKstDateString(b);
}
