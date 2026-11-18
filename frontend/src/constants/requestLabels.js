// 요청서 상태·긴급도의 화면 표시 이름과 색. 서버의 enum 값과 같은 키를 쓴다.

export const STATUS_LABELS = {
  SUBMITTED: '제출됨',
  ACCEPTED: '접수됨',
  FIRST_REVIEW: '1차 확인 대기',
  FINAL_REVIEW: '최종 확인 대기',
  REWORK: '재작업',
  COMPLETED: '완료',
};

// 글자색과 배경색은 대비가 충분한 조합을 쓴다. 색만으로 구분하지 않도록 항상 글자를 함께 보여준다.
export const STATUS_COLORS = {
  SUBMITTED: { color: '#374151', background: '#e5e7eb' },
  ACCEPTED: { color: '#1d4ed8', background: '#dbeafe' },
  FIRST_REVIEW: { color: '#92400e', background: '#fef3c7' },
  FINAL_REVIEW: { color: '#6d28d9', background: '#ede9fe' },
  REWORK: { color: '#b91c1c', background: '#fee2e2' },
  COMPLETED: { color: '#166534', background: '#dcfce7' },
};

export const URGENCY_LABELS = { LOW: '낮음', NORMAL: '보통', HIGH: '높음' };

export const URGENCY_OPTIONS = ['LOW', 'NORMAL', 'HIGH'];

export const STATUS_OPTIONS = Object.keys(STATUS_LABELS);
