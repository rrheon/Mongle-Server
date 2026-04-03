import { test, expect } from '@playwright/test';

const BASE_URL = 'https://1cq1kfgvf1.execute-api.ap-northeast-2.amazonaws.com';

// 테스트용 계정 2개 (방장 + 멤버)
const OWNER_EMAIL = 'test-owner@mongle.app';
const MEMBER_EMAIL = 'test-member@mongle.app';
const PASSWORD = 'Test1234!';
const TEST_GROUP_NAME = `테스트그룹_${Date.now()}`;

let ownerToken = '';
let memberToken = '';
let ownerUserId = ''; // DB id (UUID)
let memberUserId = '';
let familyId = '';

// ── 헬퍼 ──────────────────────────────────────────────────────────────

async function signup(request: any, name: string, email: string, password: string) {
  const res = await request.post(`${BASE_URL}/auth/email/signup`, {
    data: { name, email, password },
  });
  return res;
}

async function login(request: any, email: string, password: string) {
  const res = await request.post(`${BASE_URL}/auth/email/login`, {
    data: { email, password },
  });
  return res;
}

async function authed(request: any, token: string) {
  return {
    get: (url: string) =>
      request.get(url, { headers: { Authorization: `Bearer ${token}` } }),
    post: (url: string, data?: any) =>
      request.post(url, { headers: { Authorization: `Bearer ${token}` }, data }),
    patch: (url: string, data?: any) =>
      request.patch(url, { headers: { Authorization: `Bearer ${token}` }, data }),
    delete: (url: string) =>
      request.delete(url, { headers: { Authorization: `Bearer ${token}` } }),
  };
}

// ── 테스트 ─────────────────────────────────────────────────────────────

test.describe.serial('그룹 관리 API 테스트', () => {

  test('1. 테스트 계정 생성 또는 로그인', async ({ request }) => {
    // 방장 계정
    let res = await login(request, OWNER_EMAIL, PASSWORD);
    if (res.status() !== 200) {
      res = await signup(request, '방장', OWNER_EMAIL, PASSWORD);
      expect(res.status()).toBe(201);
    }
    const ownerData = await res.json();
    ownerToken = ownerData.token;
    ownerUserId = ownerData.user.id;
    expect(ownerToken).toBeTruthy();
    console.log('방장 로그인 성공:', ownerUserId);

    // 멤버 계정
    res = await login(request, MEMBER_EMAIL, PASSWORD);
    if (res.status() !== 200) {
      res = await signup(request, '멤버', MEMBER_EMAIL, PASSWORD);
      expect(res.status()).toBe(201);
    }
    const memberData = await res.json();
    memberToken = memberData.token;
    memberUserId = memberData.user.id;
    expect(memberToken).toBeTruthy();
    console.log('멤버 로그인 성공:', memberUserId);
  });

  test('2. 그룹 생성 (방장)', async ({ request }) => {
    const api = await authed(request, ownerToken);
    const res = await api.post(`${BASE_URL}/families`, { name: TEST_GROUP_NAME, creatorRole: 'FATHER' });
    expect(res.status()).toBe(201);
    const data = await res.json();
    familyId = data.id;
    console.log('그룹 생성:', familyId, data.inviteCode);
    expect(data.createdById).toBe(ownerUserId);

    // 멤버가 그룹에 참가
    const memberApi = await authed(request, memberToken);
    const joinRes = await memberApi.post(`${BASE_URL}/families/join`, {
      inviteCode: data.inviteCode,
      role: 'SON',
    });
    console.log('멤버 참가 상태:', joinRes.status());
    const joinData = await joinRes.json();
    console.log('멤버 참가 결과:', JSON.stringify(joinData).slice(0, 200));
    expect(joinRes.status()).toBe(200);
  });

  test('3. 내 가족 조회 → 멤버 목록 확인', async ({ request }) => {
    const api = await authed(request, ownerToken);
    const res = await api.get(`${BASE_URL}/families/my`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    console.log('가족 정보:', JSON.stringify(data, null, 2).slice(0, 500));
    console.log('멤버 수:', data.members?.length);
    console.log('멤버 IDs:', data.members?.map((m: any) => m.id));
    expect(data.members.length).toBeGreaterThanOrEqual(2);
  });

  test('4. 멤버 내보내기 (kick) 테스트', async ({ request }) => {
    const api = await authed(request, ownerToken);
    console.log(`kick 요청: DELETE /families/members/${memberUserId}`);

    const res = await api.delete(`${BASE_URL}/families/members/${memberUserId}`);
    const status = res.status();
    console.log('kick 응답 상태:', status);

    if (status !== 204) {
      const body = await res.json();
      console.log('kick 에러:', JSON.stringify(body));
    }
    expect(status).toBe(204);

    // 멤버가 그룹에서 제거되었는지 확인
    const checkRes = await api.get(`${BASE_URL}/families/my`);
    const checkData = await checkRes.json();
    console.log('kick 후 멤버 수:', checkData.members?.length);
    const memberIds = checkData.members?.map((m: any) => m.id) || [];
    expect(memberIds).not.toContain(memberUserId);
  });

  test('5. 멤버 재참가 → 방장 위임 + 나가기 테스트', async ({ request }) => {
    // 먼저 멤버를 다시 그룹에 넣기
    const ownerApi = await authed(request, ownerToken);
    const familyRes = await ownerApi.get(`${BASE_URL}/families/my`);
    const familyData = await familyRes.json();
    const inviteCode = familyData.inviteCode;

    const memberApi = await authed(request, memberToken);
    const joinRes = await memberApi.post(`${BASE_URL}/families/join`, {
      inviteCode,
      role: 'SON',
    });
    console.log('멤버 재참가 상태:', joinRes.status());

    // 방장 위임
    console.log(`transfer 요청: PATCH /families/transfer-creator, newCreatorId=${memberUserId}`);
    const transferRes = await ownerApi.patch(`${BASE_URL}/families/transfer-creator`, {
      newCreatorId: memberUserId,
    });
    const transferStatus = transferRes.status();
    console.log('transfer 응답 상태:', transferStatus);
    if (transferStatus !== 204) {
      const body = await transferRes.json();
      console.log('transfer 에러:', JSON.stringify(body));
    }
    expect(transferStatus).toBe(204);

    // 위임 후 가족 확인: createdById가 멤버로 변경되었는지
    const afterTransfer = await ownerApi.get(`${BASE_URL}/families/my`);
    const afterData = await afterTransfer.json();
    console.log('위임 후 createdById:', afterData.createdById, '(멤버 ID:', memberUserId, ')');
    expect(afterData.createdById).toBe(memberUserId);

    // 구 방장 나가기
    console.log('leave 요청: DELETE /families/leave');
    const leaveRes = await ownerApi.delete(`${BASE_URL}/families/leave`);
    const leaveStatus = leaveRes.status();
    console.log('leave 응답 상태:', leaveStatus);
    if (leaveStatus !== 204) {
      const body = await leaveRes.json();
      console.log('leave 에러:', JSON.stringify(body));
    }
    expect(leaveStatus).toBe(204);

    // 나가기 후: 구 방장의 가족 목록에서 해당 그룹이 없어야 함
    const allFamilies = await ownerApi.get(`${BASE_URL}/families/all`);
    const allData = await allFamilies.json();
    console.log('나가기 후 가족 목록:', JSON.stringify(allData).slice(0, 300));
    const familyIds = allData.families?.map((f: any) => f.id) || [];
    expect(familyIds).not.toContain(familyId);
  });

  test('6. 정리: 테스트 그룹 삭제', async ({ request }) => {
    // 멤버가 이제 방장이므로 멤버 계정으로 나가기 (혼자이므로 그룹 삭제됨)
    const memberApi = await authed(request, memberToken);

    // 먼저 해당 그룹을 활성화
    const selectRes = await memberApi.post(`${BASE_URL}/families/${familyId}/select`);
    console.log('그룹 선택 상태:', selectRes.status());

    const leaveRes = await memberApi.delete(`${BASE_URL}/families/leave`);
    console.log('정리 - 그룹 삭제 상태:', leaveRes.status());
  });
});
