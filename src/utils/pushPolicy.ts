/**
 * (MG-141) 푸시 게이팅 정책 — "디바이스 토큰을 인증 세션에서 분리"한 소프트 로그아웃의 핵심.
 *
 * 로그아웃/세션만료에도 apnsToken/fcmToken 은 보존하므로, 무엇을 보낼지는 User.sessionState 로 가른다:
 *   - 콘텐츠(가족 내용) 푸시 : active 일 때만. 로그아웃/만료된 기기에 가족 답변·질문이 새는 것을 차단.
 *   - 재참여(재로그인 유도) 푸시 : active 가 아닐 때(=expired|logged_out) + 토큰 생존 시.
 *                                "다시 로그인" 유도용으로 가족 내용은 절대 포함하지 않는다.
 *
 * 같은 기기를 다른 유저가 인계받으면 registerDeviceToken 의 토큰 회수 불변식으로 이전 유저 토큰이
 * NULL 이 되므로, 비활성 유저 대상 재참여 푸시가 새 유저 기기로 가는 일은 없다.
 */
export interface PushGateTarget {
  sessionState: string;
}

/** 콘텐츠(가족 내용) 푸시 허용 여부. notif* 토글·quietHours 는 호출부에서 별도 확인. */
export function canSendContentPush(target: PushGateTarget): boolean {
  return target.sessionState === 'active';
}

/** 재참여 푸시 대상 여부. 세션이 비활성(만료/로그아웃)인 경우. 토큰 생존 여부는 호출부에서 확인. */
export function shouldSendReengagePush(target: PushGateTarget): boolean {
  return target.sessionState !== 'active';
}
