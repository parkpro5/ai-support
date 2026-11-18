import { httpClient } from './httpClient';
import { parseApiError } from './requests.api';

/**
 * 파일은 서버를 거치지 않고 저장소에 직접 올린다(서버리스 함수의 요청 크기 제한 때문).
 * 순서: 1) 서버에서 업로드 주소 발급 → 2) 브라우저가 저장소에 업로드 → 3) 서버에 등록(실제 크기 검증).
 * @param {'request'|'work'} target request: 요청서 첨부(작성자), work: 작업내역 첨부(담당 지원자)
 */
export async function uploadAttachment(requestId, target, file) {
  const { data: issued } = await httpClient.post(`/requests/${requestId}/attachments/upload-url`, {
    target,
    fileName: file.name,
    size: file.size,
  });

  let response;
  try {
    response = await fetch(issued.uploadUrl, { method: 'PUT', headers: issued.headers, body: file });
  } catch {
    throw new Error('저장소에 연결할 수 없어 파일을 올리지 못했습니다');
  }
  if (!response.ok) {
    throw new Error(response.status === 413 ? '파일이 너무 커서 올리지 못했습니다' : '파일을 올리지 못했습니다. 잠시 후 다시 시도해 주세요');
  }

  const { data } = await httpClient.post(`/requests/${requestId}/attachments`, {
    target,
    path: issued.path,
    fileName: file.name,
  });
  return data;
}

/**
 * 여러 파일을 차례로 올린다. 한 파일이 실패해도 나머지는 계속 올린다.
 * @returns {Promise<{ uploaded: object[], failed: Array<{ file: File, message: string }> }>}
 */
export async function uploadAttachments(requestId, target, files) {
  const uploaded = [];
  const failed = [];
  for (const file of files) {
    try {
      uploaded.push(await uploadAttachment(requestId, target, file));
    } catch (err) {
      failed.push({ file, message: err.response ? parseApiError(err).message : err.message });
    }
  }
  return { uploaded, failed };
}

/** 내려받기용 서명 주소(60초 유효)를 받아 브라우저가 그 파일을 저장하게 한다. */
export async function downloadAttachment(attachmentId) {
  const { data } = await httpClient.get(`/attachments/${attachmentId}/download-url`);
  window.location.assign(data.url);
}

export async function deleteAttachment(attachmentId) {
  await httpClient.delete(`/attachments/${attachmentId}`);
}
