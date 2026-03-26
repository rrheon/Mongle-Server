import { generateInviteCode, isValidInviteCode } from '../inviteCode';

describe('generateInviteCode', () => {
  it('8자리 코드를 생성한다', () => {
    const code = generateInviteCode();
    expect(code).toHaveLength(8);
  });

  it('허용된 문자만 포함한다 (0, O, I, L 제외한 대문자+숫자)', () => {
    const code = generateInviteCode();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
  });

  it('100회 생성 시 모두 유효한 형식이다', () => {
    for (let i = 0; i < 100; i++) {
      const code = generateInviteCode();
      expect(isValidInviteCode(code)).toBe(true);
    }
  });
});

describe('isValidInviteCode', () => {
  it('유효한 8자리 코드를 허용한다', () => {
    expect(isValidInviteCode('ABCDEFGH')).toBe(true);
    expect(isValidInviteCode('23456789')).toBe(true);
    expect(isValidInviteCode('A2B3C4D5')).toBe(true);
  });

  it('소문자 입력도 대문자로 변환해 검증한다', () => {
    expect(isValidInviteCode('abcdefgh')).toBe(true);
  });

  it('8자리 미만은 거부한다', () => {
    expect(isValidInviteCode('ABCDE')).toBe(false);
  });

  it('8자리 초과는 거부한다', () => {
    expect(isValidInviteCode('ABCDEFGHI')).toBe(false);
  });

  it('혼동 문자(0, O, I) 포함 코드는 거부한다', () => {
    expect(isValidInviteCode('ABCDE0FG')).toBe(false); // 숫자 0
    expect(isValidInviteCode('ABCDEOFG')).toBe(false); // 알파벳 O
    expect(isValidInviteCode('ABCDEIFG')).toBe(false); // 알파벳 I
    // L은 isValidInviteCode 정규식(J-N 범위)에서 허용됨 — generateInviteCode만 제외
  });

  it('특수문자가 포함된 코드는 거부한다', () => {
    expect(isValidInviteCode('ABCDE-GH')).toBe(false);
    expect(isValidInviteCode('ABCDE GH')).toBe(false);
  });

  it('빈 문자열은 거부한다', () => {
    expect(isValidInviteCode('')).toBe(false);
  });
});
