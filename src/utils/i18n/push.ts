/**
 * 푸시 알림 다국어 문구.
 *
 * 수신자 User.locale (Accept-Language 기반으로 auth middleware 가 갱신) 기준으로
 * 푸시 제목/본문을 고른다. locale 미지정 시 기본값 ko.
 *
 * 클라이언트(iOS/Android) 코드 변경 없이 서버가 바로 로컬라이즈된 문자열을 APNs/FCM 페이로드에
 * 실어 보내는 방식 — 이유:
 *   - iOS 의 APNs `loc-key` 는 메인 앱 번들 `Localizable.strings` 를 찾아보는데,
 *     현재 프로젝트는 Swift Package 리소스 번들에 문자열을 두고 있어 매칭 실패.
 *   - Android 는 string resource 로 풀 수 있지만 iOS 쪽 제약 때문에 한쪽만 쪼개면 복잡.
 *     서버 단일 진입점이 가장 단순.
 */

export type Locale = 'ko' | 'en' | 'ja';

const DEFAULT_LOCALE: Locale = 'ko';

interface PushMessages {
  newQuestion: { title: string; body: string };
  memberAnswered: { title: (senderName: string) => string; body: string };
  answerReminder: { title: string; body: string; bodyMulti: (count: number) => string };
  nudge: { title: string; body: (senderName: string) => string };
}

const messagesByLocale: Record<Locale, PushMessages> = {
  ko: {
    newQuestion: {
      title: '오늘의 질문이 도착했어요!',
      body: '그룹 멤버들과 함께 오늘의 질문에 답변해보세요.',
    },
    memberAnswered: {
      title: (name) => `${name}님이 답변했어요!`,
      body: '오늘의 질문에 새 답변이 올라왔어요. 확인해보세요',
    },
    answerReminder: {
      title: '오늘의 질문, 아직 답변 전이에요',
      body: '그룹 멤버들이 오늘의 질문을 기다리고 있어요. 한마디 남겨볼까요?',
      bodyMulti: (count) => `${count}건의 미답변 질문이 있어요. 지금 확인해볼까요?`,
    },
    nudge: {
      title: '재촉하기 알림',
      body: (name) => `${name}님이 오늘의 질문에 답변해달라고 합니다`,
    },
  },
  en: {
    newQuestion: {
      title: "Today's question is here!",
      body: "Share today's question with your group.",
    },
    memberAnswered: {
      title: (name) => `${name} just answered!`,
      body: "A new answer was added to today's question. Take a look",
    },
    answerReminder: {
      title: "Today's question is waiting",
      body: 'Your group is waiting for your answer. Leave a note!',
      bodyMulti: (count) => `You have ${count} unanswered questions. Take a look now!`,
    },
    nudge: {
      title: 'A gentle nudge',
      body: (name) => `${name} is waiting for your answer on today's question`,
    },
  },
  ja: {
    newQuestion: {
      title: '今日の質問が届きました',
      body: 'グループのメンバーと一緒に今日の質問に答えてみましょう。',
    },
    memberAnswered: {
      title: (name) => `${name}さんが回答しました！`,
      body: '今日の質問に新しい回答が届きました',
    },
    answerReminder: {
      title: 'まだ回答していない質問があります',
      body: 'グループのメンバーがあなたの回答を待っています。一言どうですか？',
      bodyMulti: (count) => `${count}件の未回答の質問があります。今確認してみませんか？`,
    },
    nudge: {
      title: 'リマインドが届きました',
      body: (name) => `${name}さんが今日の質問への回答を待っています`,
    },
  },
};

/**
 * Accept-Language 헤더 문자열 → Locale enum.
 * 예: "ko-KR,ko;q=0.9,en;q=0.8" → "ko"
 * 지원 외 언어는 기본값 반환.
 */
export function resolveLocaleFromHeader(acceptLanguage: string | null | undefined): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;
  const primary = acceptLanguage.split(',')[0]?.trim().toLowerCase().slice(0, 2);
  if (primary === 'en') return 'en';
  if (primary === 'ja') return 'ja';
  if (primary === 'ko') return 'ko';
  return DEFAULT_LOCALE;
}

/**
 * DB 에 저장된 user.locale (nullable) 을 Locale 로 정규화.
 */
export function normalizeLocale(locale: string | null | undefined): Locale {
  if (locale === 'en' || locale === 'ja' || locale === 'ko') return locale;
  return DEFAULT_LOCALE;
}

/**
 * 주어진 locale 에 해당하는 푸시 문구 세트를 반환.
 */
export function getPushMessages(locale: string | null | undefined): PushMessages {
  return messagesByLocale[normalizeLocale(locale)];
}
