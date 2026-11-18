// 첨부파일 규칙(화면에서 미리 알려 주기 위한 것). 서버의 backend/src/modules/attachments/attachment.rules.js 와 같아야 한다.
// 서버가 항상 다시 검사하므로, 이 검사는 사용자가 헛수고하지 않게 하는 안내일 뿐 보안 장치가 아니다.

export const ALLOWED_EXTENSIONS = ['pdf', 'hwp', 'hwpx', 'docx', 'xlsx', 'pptx', 'png', 'jpg', 'jpeg'];
export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB
export const MAX_FILES = 10;

/** <input type="file" accept="..."> 에 넣을 값. */
export const ACCEPT_ATTRIBUTE = ALLOWED_EXTENSIONS.map((ext) => `.${ext}`).join(',');

function extensionOf(fileName) {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 && dot < fileName.length - 1 ? fileName.slice(dot + 1).toLowerCase() : '';
}

/** 올릴 수 없는 파일이면 이유(문장), 올릴 수 있으면 null. */
export function validateClientFile(file) {
  if (!ALLOWED_EXTENSIONS.includes(extensionOf(file.name))) {
    return `허용되지 않는 형식입니다. ${ALLOWED_EXTENSIONS.join(', ')} 파일만 올릴 수 있습니다`;
  }
  if (file.size <= 0) return '빈 파일은 올릴 수 없습니다';
  if (file.size > MAX_FILE_BYTES) return `파일 크기는 ${MAX_FILE_BYTES / (1024 * 1024)}MB 이하여야 합니다`;
  return null;
}

/** 1536 → "1.5KB". */
export function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace(/\.0$/, '')}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')}MB`;
}
