/** 90 → "1시간 30분". 소요 시간(분)을 사람이 읽기 쉬운 형태로 바꾼다. 올바른 정수가 아니면 빈 문자열. */
export function formatMinutes(minutes) {
  if (!Number.isInteger(minutes) || minutes < 0) return '';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}분`;
  return rest === 0 ? `${hours}시간` : `${hours}시간 ${rest}분`;
}

/**
 * 처리에 걸린 시간(분)을 큰 단위 두 개까지로: 4320 → "3일", 1500 → "1일 1시간", 95 → "1시간 35분".
 * 값이 없으면(null) "-". 대시보드의 평균 처리 시간에 쓴다.
 */
export function formatElapsed(minutes) {
  if (!Number.isFinite(minutes) || minutes < 0) return '-';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  if (days > 0) return hours > 0 ? `${days}일 ${hours}시간` : `${days}일`;
  if (hours > 0) return rest > 0 ? `${hours}시간 ${rest}분` : `${hours}시간`;
  return `${rest}분`;
}

/** "2026-11" → "2026년 11월". 형식이 아니면 받은 값을 그대로 돌려준다. */
export function formatMonth(month) {
  const match = /^(\d{4})-(\d{2})$/.exec(month ?? '');
  return match ? `${match[1]}년 ${Number(match[2])}월` : String(month ?? '');
}

/** ISO 시각을 브라우저 로컬 시각의 "2026. 11. 18. 오후 3:05" 형태로 보여준다. */
export function formatDateTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
}
