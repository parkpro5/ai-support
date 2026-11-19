import { httpClient } from './httpClient';

/** @param {{ status?: string, scope?: 'available'|'mine', page?: number, pageSize?: number }} params */
export async function fetchRequests(params = {}) {
  const { data } = await httpClient.get('/requests', { params });
  return data;
}

export async function fetchRequest(id) {
  const { data } = await httpClient.get(`/requests/${id}`);
  return data;
}

export async function createRequest(body) {
  const { data } = await httpClient.post('/requests', body);
  return data;
}

export async function updateRequest(id, body) {
  const { data } = await httpClient.patch(`/requests/${id}`, body);
  return data;
}

export async function deleteRequest(id) {
  await httpClient.delete(`/requests/${id}`);
}

/**
 * 작성자가 완료된 요청서에 만족도를 남긴다(1회). 점수는 1~5, 후기는 한 줄(선택).
 * 완료 전이면 400, 작성자가 아니면 403, 이미 남겼다면 409. 갱신된 요청서를 돌려준다.
 */
export async function rateRequest(id, { score, comment }) {
  const { data } = await httpClient.post(`/requests/${id}/rating`, { score, comment });
  return data;
}

/**
 * 새 요청서 작성 화면의 기본값. 담당자 이름은 로그인한 계정의 이름이고, 소속은 가장 최근에 작성한 요청서의 소속(처음이면 null)이다.
 * @returns {Promise<{ contactName: string, department: string|null }>}
 */
export async function fetchFormDefaults() {
  const { data } = await httpClient.get('/requests/form-defaults');
  return data;
}

/** 지원자가 요청서를 접수한다. 다른 지원자가 먼저 접수했으면 409. */
export async function acceptRequest(id) {
  const { data } = await httpClient.post(`/requests/${id}/accept`);
  return data;
}

/** 담당 지원자가 접수를 취소한다. 요청서는 제출됨으로 돌아간다. */
export async function cancelAcceptRequest(id) {
  const { data } = await httpClient.post(`/requests/${id}/cancel-accept`);
  return data;
}

/** 담당 지원자가 작업내역(내용과 소요 분)을 제출한다. 요청서는 1차 확인 대기가 된다. */
export async function submitWorkLog(id, body) {
  const { data } = await httpClient.post(`/requests/${id}/work-logs`, body);
  return data;
}

/**
 * 요청서 작성자가 작업내역을 1차 확인한다.
 * @param {{ decision: 'APPROVE'|'REJECT', reason?: string }} body 반려(REJECT)에는 사유가 필수
 */
export async function reviewFirst(id, body) {
  const { data } = await httpClient.post(`/requests/${id}/first-review`, body);
  return data;
}

/**
 * 관리자가 작업내역을 최종 확인한다. 승인하면 완료, 반려(사유 필수)하면 재작업이 된다.
 * @param {{ decision: 'APPROVE'|'REJECT', reason?: string }} body
 */
export async function reviewFinal(id, body) {
  const { data } = await httpClient.post(`/requests/${id}/final-review`, body);
  return data;
}

/**
 * 관리자가 제출됨 요청서를 지원자에게 직접 배정한다. 요청서는 접수됨이 된다.
 * @param {string} supporterId 지원자로 지정된 사용자의 id
 */
export async function assignRequest(id, supporterId) {
  const { data } = await httpClient.post(`/requests/${id}/assign`, { supporterId });
  return data;
}

export async function fetchSupportTypes() {
  const { data } = await httpClient.get('/support-types');
  return data;
}

/** 서버 오류 응답에서 사람이 읽을 메시지와 항목별 오류를 꺼낸다. */
export function parseApiError(error) {
  const body = error.response?.data?.error;
  return {
    status: error.response?.status ?? null,
    message: body?.message ?? '서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.',
    details: body?.details ?? {},
  };
}
