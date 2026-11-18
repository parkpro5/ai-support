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
