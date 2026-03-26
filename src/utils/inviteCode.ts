/**
 * 8자리 초대 코드 생성
 * 형식: 대문자 + 숫자 조합 (혼동되기 쉬운 문자 제외: 0, O, I, L)
 */
export function generateInviteCode(): string {
  const characters = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';

  for (let i = 0; i < 8; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    code += characters[randomIndex];
  }

  return code;
}

/**
 * 초대 코드 유효성 검사
 */
export function isValidInviteCode(code: string): boolean {
  const pattern = /^[A-HJ-NP-Z2-9]{8}$/;
  return pattern.test(code.toUpperCase());
}
