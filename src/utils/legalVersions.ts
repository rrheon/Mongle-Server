/**
 * 약관/개인정보 처리방침 현재 버전.
 *
 * Legal/ 폴더의 마크다운 문서를 개정할 때마다 여기 버전을 올려야 한다.
 * 사용자의 users.terms_accepted_version / privacy_accepted_version 과
 * 비교하여 다르면 클라이언트에 needsConsent=true 를 반환 → 재동의 모달.
 *
 * Semantic versioning 을 따르되, 실제로는 단순 문자열 비교만 한다.
 * (다른 값이면 무조건 재동의)
 */
export const LEGAL_VERSIONS = {
  terms: '1.0.0',
  privacy: '1.0.0',
} as const;

export type LegalDocType = keyof typeof LEGAL_VERSIONS;

export type LegalLang = 'ko' | 'en' | 'ja';

const SUPPORTED_LANGS: ReadonlySet<LegalLang> = new Set(['ko', 'en', 'ja']);

export function normalizeLegalLang(input?: string | null): LegalLang {
  if (!input) return 'ko';
  const lower = input.toLowerCase().split(/[-_]/)[0];
  if (SUPPORTED_LANGS.has(lower as LegalLang)) return lower as LegalLang;
  return 'ko';
}
