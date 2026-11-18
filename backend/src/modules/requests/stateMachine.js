/**
 * 요청서 상태 전이 규칙. 순수 함수만 둔다(DB·HTTP 접근 금지).
 * 모든 API는 상태를 바꾸기 전에 반드시 transition()을 거친다.
 *
 * 흐름:
 *   SUBMITTED ─ACCEPT/ASSIGN→ ACCEPTED ─WORK_SUBMIT→ FIRST_REVIEW ─FIRST_APPROVE→ FINAL_REVIEW ─FINAL_APPROVE→ COMPLETED
 *   ACCEPTED ─CANCEL_ACCEPT→ SUBMITTED
 *   FIRST_REVIEW ─FIRST_REJECT→ REWORK      FINAL_REVIEW ─FINAL_REJECT→ REWORK
 *   REWORK ─RESUBMIT→ FIRST_REVIEW (재제출은 항상 1차 확인부터 다시)
 */

const STATUS = Object.freeze({
  SUBMITTED: 'SUBMITTED',
  ACCEPTED: 'ACCEPTED',
  FIRST_REVIEW: 'FIRST_REVIEW',
  FINAL_REVIEW: 'FINAL_REVIEW',
  REWORK: 'REWORK',
  COMPLETED: 'COMPLETED',
});

/** 값은 Prisma RequestEventType과 같다. 전이가 성공하면 이 값이 그대로 eventType이 된다. */
const ACTION = Object.freeze({
  ACCEPT: 'ACCEPT',
  CANCEL_ACCEPT: 'CANCEL_ACCEPT',
  ASSIGN: 'ASSIGN',
  WORK_SUBMIT: 'WORK_SUBMIT',
  FIRST_APPROVE: 'FIRST_APPROVE',
  FIRST_REJECT: 'FIRST_REJECT',
  FINAL_APPROVE: 'FINAL_APPROVE',
  FINAL_REJECT: 'FINAL_REJECT',
  RESUBMIT: 'RESUBMIT',
});

/** 오류 코드와 HTTP 상태. API 계층은 err.statusCode를 그대로 응답에 쓸 수 있다. */
const ERROR_STATUS = Object.freeze({
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  UNKNOWN_ACTION: 400,
  REASON_REQUIRED: 400,
  INVALID_STATE: 409,
});

class TransitionError extends Error {
  /**
   * @param {keyof typeof ERROR_STATUS} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'TransitionError';
    this.code = code;
    this.statusCode = ERROR_STATUS[code];
  }
}

// ── 행위자 조건 ───────────────────────────────────────────────
const hasRole = (role) => (request, actor) => actor.role === role;
const isRequester = (request, actor) => actor.id === request.requesterId;
const isAssignedSupporter = (request, actor) =>
  actor.role === 'SUPPORTER' && request.assigneeId != null && actor.id === request.assigneeId;

/**
 * action → { from(현재 상태), to(다음 상태), allowed(행위자 조건), needsReason }
 * @type {Record<string, { from: string, to: string, allowed: (request: object, actor: object) => boolean, needsReason?: boolean }>}
 */
const RULES = {
  [ACTION.ACCEPT]: { from: STATUS.SUBMITTED, to: STATUS.ACCEPTED, allowed: hasRole('SUPPORTER') },
  [ACTION.ASSIGN]: { from: STATUS.SUBMITTED, to: STATUS.ACCEPTED, allowed: hasRole('ADMIN') },
  [ACTION.CANCEL_ACCEPT]: { from: STATUS.ACCEPTED, to: STATUS.SUBMITTED, allowed: isAssignedSupporter },
  [ACTION.WORK_SUBMIT]: { from: STATUS.ACCEPTED, to: STATUS.FIRST_REVIEW, allowed: isAssignedSupporter },
  [ACTION.FIRST_APPROVE]: { from: STATUS.FIRST_REVIEW, to: STATUS.FINAL_REVIEW, allowed: isRequester },
  [ACTION.FIRST_REJECT]: {
    from: STATUS.FIRST_REVIEW,
    to: STATUS.REWORK,
    allowed: isRequester,
    needsReason: true,
  },
  [ACTION.FINAL_APPROVE]: { from: STATUS.FINAL_REVIEW, to: STATUS.COMPLETED, allowed: hasRole('ADMIN') },
  [ACTION.FINAL_REJECT]: {
    from: STATUS.FINAL_REVIEW,
    to: STATUS.REWORK,
    allowed: hasRole('ADMIN'),
    needsReason: true,
  },
  [ACTION.RESUBMIT]: { from: STATUS.REWORK, to: STATUS.FIRST_REVIEW, allowed: isAssignedSupporter },
};

/**
 * 요청서에 action을 적용했을 때의 다음 상태를 계산한다. 입력 객체는 바꾸지 않는다.
 *
 * 검사 순서: 행위자 권한(403) → 현재 상태(409) → 사유(400).
 * 권한이 없는 사용자에게는 요청서의 현재 상태를 알려주지 않기 위해 권한을 먼저 본다.
 *
 * @param {{ status: string, requesterId: string, assigneeId?: string|null }} request
 * @param {keyof typeof ACTION} action
 * @param {{ id: string, role: 'REQUESTER'|'SUPPORTER'|'ADMIN' }} actor
 * @param {{ reason?: string }} [payload] 반려(FIRST_REJECT, FINAL_REJECT)에서는 reason이 필수다.
 * @returns {{ status: string, eventType: string }}
 * @throws {TransitionError}
 */
function transition(request, action, actor, payload = {}) {
  const rule = Object.hasOwn(RULES, action) ? RULES[action] : null;
  if (!rule) {
    throw new TransitionError('UNKNOWN_ACTION', `Unknown action: ${String(action)}`);
  }
  if (!actor || !actor.id) {
    throw new TransitionError('UNAUTHENTICATED', 'Authentication required');
  }
  if (!rule.allowed(request, actor)) {
    throw new TransitionError('FORBIDDEN', `Actor is not allowed to ${action}`);
  }
  if (request.status !== rule.from) {
    throw new TransitionError('INVALID_STATE', `Cannot ${action} a request in status ${request.status}`);
  }
  if (rule.needsReason && !(typeof payload.reason === 'string' && payload.reason.trim() !== '')) {
    throw new TransitionError('REASON_REQUIRED', `${action} requires a reason`);
  }

  return Object.freeze({ status: rule.to, eventType: action });
}

module.exports = { STATUS, ACTION, TransitionError, transition };
