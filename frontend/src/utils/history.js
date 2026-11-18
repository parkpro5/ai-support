// 요청서 처리 이력(events)을 화면에 보여주기 위한 문구와 도우미.

/** 이력 종류별 한 줄 설명. 행위자 이름은 화면에서 따로 붙인다. */
export const EVENT_LABELS = {
  SUBMIT: '요청서를 제출했습니다',
  ACCEPT: '요청서를 접수했습니다',
  CANCEL_ACCEPT: '접수를 취소했습니다',
  ASSIGN: '지원자에게 요청서를 배정했습니다',
  WORK_SUBMIT: '작업내역을 제출했습니다',
  FIRST_APPROVE: '1차 확인을 승인했습니다',
  FIRST_REJECT: '1차 확인에서 반려했습니다',
  FINAL_APPROVE: '최종 승인했습니다',
  FINAL_REJECT: '최종 확인에서 반려했습니다',
  RESUBMIT: '재작업한 작업내역을 다시 제출했습니다',
};

const REJECT_TYPES = new Set(['FIRST_REJECT', 'FINAL_REJECT']);

/** 반려 이력인지. */
export function isRejection(event) {
  return REJECT_TYPES.has(event.type);
}

/** 가장 최근 반려 이력(없으면 null). 재작업 중인 지원자에게 "왜 반려됐는지"를 보여줄 때 쓴다. */
export function latestRejection(events = []) {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (isRejection(events[i])) return events[i];
  }
  return null;
}
