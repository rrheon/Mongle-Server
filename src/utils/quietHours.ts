/**
 * 사용자별 quiet hours (방해 금지 시간) 검사. 모든 푸시 경로에서 호출되어
 * 시간대 안이면 푸시를 건너뛴다. DB 알림은 그대로 저장하므로 사용자가 앱을 열면
 * 알림 리스트에서 확인 가능.
 *
 * 정책:
 *   - quietHoursEnabled=false 이면 항상 false (적용 안 함)
 *   - "HH:mm" 형식의 start/end 를 KST 기준으로 비교
 *   - end < start (예: 22:00 ~ 08:00) 면 자정을 가로지르는 윈도우로 해석
 *   - end == start (동일 시각) 은 비활성으로 간주 (전체 시간 차단 방지)
 */

const KST_TZ = 'Asia/Seoul';

function parseHHmmToMinutes(s: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

function nowKstMinutes(now: Date = new Date()): number {
  const hhmm = now.toLocaleTimeString('en-GB', {
    timeZone: KST_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const [hh, mm] = hhmm.split(':').map((s) => parseInt(s, 10));
  return hh * 60 + mm;
}

export function isInQuietHours(
  prefs: {
    quietHoursEnabled: boolean;
    quietHoursStart: string;
    quietHoursEnd: string;
  } | null | undefined,
  now: Date = new Date()
): boolean {
  if (!prefs || !prefs.quietHoursEnabled) return false;
  const start = parseHHmmToMinutes(prefs.quietHoursStart);
  const end = parseHHmmToMinutes(prefs.quietHoursEnd);
  if (start == null || end == null) return false;
  if (start === end) return false;

  const t = nowKstMinutes(now);
  if (start < end) {
    return t >= start && t < end;
  }
  return t >= start || t < end;
}
