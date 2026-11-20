/**
 * 요청서 상태 변화에 따른 알림의 대상과 문구. 순수 함수만 둔다(DB·전송 접근 금지).
 *
 * 누구에게 보내는가 (FR-9)
 * - SUBMIT(요청서 제출)            → 모든 지원자와 모든 관리자  "새 지원요청이 올라왔습니다"
 * - ACCEPT(지원자 접수)            → 요청서 작성자    "요청서가 접수되었습니다"
 * - DUE_SOON(희망 완료일 하루 전)   → 지금 처리할 차례인 사람 (상태별, 아래 규칙 참고). 완료된 요청서는 보내지 않는다.
 * - ASSIGN(관리자 배정)            → 배정받은 지원자  (지침서 FR-9에는 없지만 배정받은 사람이 몰라서는 안 되므로 추가)
 * - WORK_SUBMIT / RESUBMIT        → 요청서 작성자    "작업내역을 확인해 주세요"
 * - FIRST_APPROVE(1차 승인)        → 모든 관리자      "최종 확인 요청"
 * - FIRST_REJECT / FINAL_REJECT   → 담당 지원자      "반려되었습니다. 다시 작업해 주세요"
 * - FINAL_APPROVE(완료)            → 작성자와 담당 지원자
 * 그 외 이력(접수 취소 등)은 알림을 보내지 않는다.
 */

const MAX_TITLE_IN_BODY = 60;

/** 알림 본문에 넣을 요청서 제목. 길면 줄인다. */
function shortTitle(title) {
  const text = String(title ?? '').trim();
  return text.length > MAX_TITLE_IN_BODY ? `${text.slice(0, MAX_TITLE_IN_BODY)}…` : text;
}

const DUE_SOON_BY_STATUS = {
  SUBMITTED: () => ({
    title: '내일이 희망 완료일인데 아직 접수되지 않았습니다',
    url: '/requests',
    audience: { roles: ['SUPPORTER', 'ADMIN'] },
  }),
  ACCEPTED: (r) => ({
    title: '내일이 희망 완료일입니다. 작업내역을 제출해 주세요',
    url: `/requests/${r.id}/work`,
    audience: { userIds: [r.assigneeId] },
  }),
  REWORK: (r) => ({
    title: '내일이 희망 완료일입니다. 재작업 내용을 제출해 주세요',
    url: `/requests/${r.id}/work`,
    audience: { userIds: [r.assigneeId] },
  }),
  FIRST_REVIEW: (r) => ({
    title: '내일이 희망 완료일입니다. 작업내역을 확인해 주세요',
    url: `/requests/${r.id}/review`,
    audience: { userIds: [r.requesterId] },
  }),
  FINAL_REVIEW: (r) => ({
    title: '내일이 희망 완료일입니다. 최종 확인이 필요합니다',
    url: `/requests/${r.id}/final-review`,
    audience: { roles: ['ADMIN'] },
  }),
};

/**
 * 이력 종류별 규칙. audience는 `{ roles, userIds }` 중 필요한 것만 담는다.
 * url은 알림을 눌렀을 때 열릴 화면이다.
 */
const RULES = {
  SUBMIT: () => ({
    title: '새 지원요청이 올라왔습니다',
    url: '/requests',
    audience: { roles: ['SUPPORTER', 'ADMIN'] },
  }),
  ACCEPT: (r) => ({
    title: '요청서가 접수되었습니다',
    url: `/requests/${r.id}`,
    audience: { userIds: [r.requesterId] },
  }),
  ASSIGN: (r) => ({
    title: '요청서가 배정되었습니다',
    url: `/requests/${r.id}/work`,
    audience: { userIds: [r.assigneeId] },
  }),
  WORK_SUBMIT: (r) => ({
    title: '작업내역을 확인해 주세요',
    url: `/requests/${r.id}/review`,
    audience: { userIds: [r.requesterId] },
  }),
  RESUBMIT: (r) => ({
    title: '재작업한 작업내역을 확인해 주세요',
    url: `/requests/${r.id}/review`,
    audience: { userIds: [r.requesterId] },
  }),
  FIRST_APPROVE: (r) => ({
    title: '최종 확인이 필요합니다',
    url: `/requests/${r.id}/final-review`,
    audience: { roles: ['ADMIN'] },
  }),
  FIRST_REJECT: (r) => ({
    title: '작업내역이 반려되었습니다. 다시 작업해 주세요',
    url: `/requests/${r.id}/work`,
    audience: { userIds: [r.assigneeId] },
  }),
  FINAL_REJECT: (r) => ({
    title: '작업내역이 반려되었습니다. 다시 작업해 주세요',
    url: `/requests/${r.id}/work`,
    audience: { userIds: [r.assigneeId] },
  }),
  FINAL_APPROVE: (r) => ({
    title: '요청서가 완료되었습니다',
    url: `/requests/${r.id}`,
    audience: { userIds: [r.requesterId, r.assigneeId] },
  }),
  // 희망 완료일 하루 전: 지금 그 요청서를 처리할 차례인 사람에게만 보낸다. 완료된 요청서(와 모르는 상태)는 null.
  DUE_SOON: (r) => (Object.hasOwn(DUE_SOON_BY_STATUS, r.status) ? DUE_SOON_BY_STATUS[r.status](r) : null),
};

/**
 * @param {string} eventType RequestEventType 값 또는 'DUE_SOON'
 * @param {{ id: string, title: string, status?: string, requesterId: string, assigneeId?: string|null }} request
 * @returns {{ payload: { title: string, body: string, url: string }, audience: { roles?: string[], userIds?: string[] } } | null}
 *   알림을 보내지 않는 이력이면 null
 */
function buildNotification(eventType, request) {
  const rule = Object.hasOwn(RULES, eventType) ? RULES[eventType] : null;
  if (!rule) return null;

  const built = rule(request);
  if (!built) return null;
  const { title, url, audience } = built;
  const cleaned = {};
  if (audience.roles) cleaned.roles = [...audience.roles];
  if (audience.userIds) cleaned.userIds = audience.userIds.filter(Boolean);

  return { payload: { title, body: shortTitle(request.title), url }, audience: cleaned };
}

/**
 * 알림을 받을 사용자 id 목록을 만든다. 행동한 본인은 뺀다(자기가 한 일을 알림으로 받을 필요가 없다).
 * @param {{ roles?: string[], userIds?: string[] }} audience
 * @param {string[]} userIdsOfRoles audience.roles에 속한 사용자 id (DB에서 읽은 값)
 * @param {string} actorId
 */
function resolveRecipients(audience, userIdsOfRoles, actorId) {
  const ids = new Set([...(audience.userIds ?? []), ...userIdsOfRoles]);
  ids.delete(actorId);
  return [...ids];
}

module.exports = { buildNotification, resolveRecipients, shortTitle, MAX_TITLE_IN_BODY };
