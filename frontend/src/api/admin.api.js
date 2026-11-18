import { httpClient } from './httpClient';

// ── 사용자·역할 ──
/** @param {{ role?: 'REQUESTER'|'SUPPORTER'|'ADMIN', q?: string, page?: number, pageSize?: number }} params */
export async function fetchUsers(params = {}) {
  const { data } = await httpClient.get('/admin/users', { params });
  return data;
}

/** 사용자를 요청자 또는 지원자로 바꾼다. 관리자 계정과 진행 중인 담당 요청서가 있는 지원자 해제는 거부된다. */
export async function setUserRole(id, role) {
  const { data } = await httpClient.patch(`/admin/users/${id}/role`, { role });
  return data;
}

// ── 지원자 이메일 등록 ──
/**
 * 지원자를 이메일로 미리 등록한다. 이미 가입한 사람은 바로 지원자가 되고, 아직 가입하지 않은 사람은
 * 그 이메일로 처음 로그인할 때 지원자로 시작한다. 이메일마다 결과가 따로 나온다.
 * @param {string[]} emails
 * @returns {Promise<{ results: Array<{ email: string, result: 'PROMOTED'|'INVITED'|'ALREADY_SUPPORTER'|'ALREADY_INVITED'|'ADMIN' }> }>}
 */
export async function registerSupporters(emails) {
  const { data } = await httpClient.post('/admin/supporters', { emails });
  return data;
}

/** 아직 로그인하지 않아 대기 중인 지원자 등록 목록. */
export async function fetchSupporterInvites() {
  const { data } = await httpClient.get('/admin/supporter-invites');
  return data;
}

/** 대기 중인 등록을 취소한다(이메일을 잘못 넣었을 때). */
export async function deleteSupporterInvite(id) {
  await httpClient.delete(`/admin/supporter-invites/${id}`);
}

// ── 지원 유형 ──
/** 사용 중이 아닌 유형까지 모두, 표시 순서대로. */
export async function fetchAllSupportTypes() {
  const { data } = await httpClient.get('/admin/support-types');
  return data;
}

export async function createSupportType(name) {
  const { data } = await httpClient.post('/admin/support-types', { name });
  return data;
}

/** @param {{ name?: string, active?: boolean, sortOrder?: number }} body */
export async function updateSupportType(id, body) {
  const { data } = await httpClient.patch(`/admin/support-types/${id}`, body);
  return data;
}
