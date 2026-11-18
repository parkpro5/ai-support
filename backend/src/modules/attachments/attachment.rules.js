/**
 * 첨부파일 규칙. 순수 함수와 상수만 둔다(DB·저장소 접근 금지).
 * 프런트(frontend/src/utils/attachmentRules.js)의 값과 같아야 한다.
 */

/** 허용 확장자 → 저장할 때 붙이는 표준 content-type. (클라이언트가 보낸 형식은 믿지 않고 확장자로 정한다.) */
const ALLOWED_TYPES = Object.freeze({
  pdf: 'application/pdf',
  hwp: 'application/x-hwp',
  hwpx: 'application/hwp+zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
});

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB
/** 한 번에 붙일 수 있는 파일 수(요청서에, 작업내역 제출 한 번에 각각). 남용을 막기 위한 상한이다. */
const MAX_FILES_PER_TARGET = 10;
const MAX_FILE_NAME_LENGTH = 150;
/** 업로드·다운로드용 서명 URL이 유효한 시간(초). 다운로드는 짧게 둔다. */
const DOWNLOAD_URL_TTL_SECONDS = 60;

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/**
 * 사용자가 보낸 파일 이름을 안전하게 다듬는다. 경로 구분자와 제어문자를 없애고 길이를 제한한다.
 * (화면 표시와 다운로드 이름에만 쓰이고, 저장소 경로에는 쓰이지 않는다.)
 * @returns {string} 쓸 수 있는 이름이 없으면 빈 문자열
 */
function sanitizeFileName(name) {
  const base = String(name ?? '')
    .split(/[\\/]/)
    .pop()
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  if (base.length <= MAX_FILE_NAME_LENGTH) return base;

  // 길면 확장자를 살리고 앞부분을 줄인다.
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot) : '';
  return base.slice(0, MAX_FILE_NAME_LENGTH - ext.length) + ext;
}

/** 소문자 확장자(점 없이). 없으면 빈 문자열. */
function extensionOf(fileName) {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 && dot < fileName.length - 1 ? fileName.slice(dot + 1).toLowerCase() : '';
}

/**
 * 업로드하려는 파일을 검사한다.
 * @param {{ fileName: unknown, size: unknown }} input
 * @returns {{ ok: true, fileName: string, ext: string, contentType: string } | { ok: false, field: 'fileName'|'size', message: string }}
 */
function validateFile({ fileName, size }) {
  const cleaned = sanitizeFileName(fileName);
  if (!cleaned) return { ok: false, field: 'fileName', message: '파일 이름을 확인할 수 없습니다' };

  const ext = extensionOf(cleaned);
  if (!Object.hasOwn(ALLOWED_TYPES, ext)) {
    return {
      ok: false,
      field: 'fileName',
      message: `허용되지 않는 파일 형식입니다. ${Object.keys(ALLOWED_TYPES).join(', ')} 파일만 올릴 수 있습니다`,
    };
  }

  if (!Number.isInteger(size) || size <= 0) {
    return { ok: false, field: 'size', message: '빈 파일은 올릴 수 없습니다' };
  }
  if (size > MAX_FILE_BYTES) {
    return { ok: false, field: 'size', message: `파일 크기는 ${MAX_FILE_BYTES / (1024 * 1024)}MB 이하여야 합니다` };
  }
  return { ok: true, fileName: cleaned, ext, contentType: ALLOWED_TYPES[ext] };
}

/**
 * 저장소 경로. 사용자가 보낸 이름은 넣지 않는다(경로 조작을 막고, 같은 이름이 겹쳐도 덮어쓰지 않도록).
 * 형식: `<요청서 id>/<uuid>.<확장자>`
 */
function buildStoragePath(requestId, ext, uuid) {
  return `${requestId}/${uuid}.${ext}`;
}

/** 이 경로가 해당 요청서용으로 만든 형식인지. 다른 요청서의 파일을 등록하는 것을 막는다. */
function isStoragePathForRequest(path, requestId) {
  if (typeof path !== 'string') return false;
  const escaped = requestId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exts = Object.keys(ALLOWED_TYPES).join('|');
  return new RegExp(`^${escaped}/${UUID}\\.(${exts})$`).test(path);
}

module.exports = {
  ALLOWED_TYPES,
  MAX_FILE_BYTES,
  MAX_FILES_PER_TARGET,
  MAX_FILE_NAME_LENGTH,
  DOWNLOAD_URL_TTL_SECONDS,
  sanitizeFileName,
  extensionOf,
  validateFile,
  buildStoragePath,
  isStoragePathForRequest,
};
