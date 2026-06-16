import { canSendContentPush, shouldSendReengagePush } from '../pushPolicy';

// (MG-141) 소프트 로그아웃 게이팅 정책 — 디바이스 토큰은 보존하되 sessionState 로 발송 종류를 가른다.
describe('pushPolicy (MG-141)', () => {
  describe('canSendContentPush — 콘텐츠(가족 내용) 푸시', () => {
    it('active 세션에만 콘텐츠 푸시를 허용한다', () => {
      expect(canSendContentPush({ sessionState: 'active' })).toBe(true);
    });
    it('expired / logged_out 세션에는 콘텐츠 푸시를 차단한다 (프라이버시 회귀 방지)', () => {
      expect(canSendContentPush({ sessionState: 'expired' })).toBe(false);
      expect(canSendContentPush({ sessionState: 'logged_out' })).toBe(false);
    });
  });

  describe('shouldSendReengagePush — 재참여(재로그인 유도) 푸시', () => {
    it('비활성 세션(expired/logged_out)을 재참여 대상으로 본다', () => {
      expect(shouldSendReengagePush({ sessionState: 'expired' })).toBe(true);
      expect(shouldSendReengagePush({ sessionState: 'logged_out' })).toBe(true);
    });
    it('active 세션은 재참여 대상이 아니다', () => {
      expect(shouldSendReengagePush({ sessionState: 'active' })).toBe(false);
    });
  });

  it('콘텐츠와 재참여는 상호 배타적이다 (한 세션에 둘 다 보내지 않는다)', () => {
    for (const sessionState of ['active', 'expired', 'logged_out']) {
      const t = { sessionState };
      expect(canSendContentPush(t) && shouldSendReengagePush(t)).toBe(false);
    }
  });
});
