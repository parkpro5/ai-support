/**
 * 요청서의 조회 범위와 노출 규칙. 순수 함수만 둔다(DB 접근 금지).
 *
 * 조회 범위
 * - 관리자: 전체
 * - 요청자: 본인이 작성한 요청서
 * - 지원자: 접수 가능한(SUBMITTED) 요청서 + 본인이 담당하는 요청서
 */
const { STATUS } = require('./stateMachine');
const { canSeeAttachment, toAttachmentView } = require('../attachments/attachment.policy');

/**
 * 목록 조회용 Prisma where 조건을 만든다.
 * @param {{ id: string, role: string }} user
 * @param {{ status?: string, scope?: 'available'|'mine' }} [query]
 */
function buildListWhere(user, { status, scope } = {}) {
  let base;
  if (user.role === 'ADMIN') {
    base = {};
  } else if (user.role === 'SUPPORTER') {
    base = scope === 'mine' ? { assigneeId: user.id } : { status: STATUS.SUBMITTED };
  } else {
    base = { requesterId: user.id };
  }
  return status ? { AND: [base, { status }] } : base;
}

/** 단건 조회 권한. buildListWhere와 같은 범위여야 한다. */
function canViewRequest(user, request) {
  if (user.role === 'ADMIN') return true;
  if (user.role === 'SUPPORTER') {
    return request.status === STATUS.SUBMITTED || request.assigneeId === user.id;
  }
  return request.requesterId === user.id;
}

/**
 * 처리 이력·작업내역·첨부를 볼 수 있는 사람: 작성자, 담당 지원자, 관리자.
 * 접수 가능 목록을 둘러보는 다른 지원자는 포함하지 않는다(이전 담당자·반려 사유가 드러나면 안 된다).
 */
function canSeeHistory(user, request) {
  return (
    user.role === 'ADMIN' ||
    request.requesterId === user.id ||
    (request.assigneeId != null && request.assigneeId === user.id)
  );
}

/**
 * 연락처(전화번호)를 볼 수 있는 사람: 이력을 볼 수 있는 사람(작성자, 담당 지원자, 관리자)과,
 * **접수 가능한(제출됨) 요청서를 둘러보는 지원자**. 지원자가 접수하기 전에 전화로 내용을 확인하거나
 * 방문 일정을 조율할 수 있게 하려는 것이다. 다른 지원자가 접수하면 그 요청서는 더 이상 보이지 않으므로
 * 연락처도 함께 가려진다.
 */
function canSeeContactPhone(user, request) {
  if (canSeeHistory(user, request)) return true;
  return user.role === 'SUPPORTER' && request.status === STATUS.SUBMITTED;
}

/** 작성자 본인이 제출됨 상태일 때만 수정·삭제할 수 있다. */
function canEditRequest(user, request) {
  return request.requesterId === user.id && request.status === STATUS.SUBMITTED;
}

/** 지원자는 제출됨 요청서를 접수할 수 있다. (화면의 버튼 표시용이며 실제 검사는 상태 전이에서 한다.) */
function canAcceptRequest(user, request) {
  return user.role === 'SUPPORTER' && request.status === STATUS.SUBMITTED;
}

/** 요청서의 담당 지원자 본인인지. (역할이 지원자가 아니게 바뀌었다면 담당이어도 false) */
function isAssignedSupporter(user, request) {
  return user.role === 'SUPPORTER' && request.assigneeId != null && request.assigneeId === user.id;
}

/** 담당 지원자는 작업내역 제출 전(접수됨 상태)까지 접수를 취소할 수 있다. */
function canCancelAcceptRequest(user, request) {
  return request.status === STATUS.ACCEPTED && isAssignedSupporter(user, request);
}

/** 담당 지원자는 접수됨 상태에서 첫 작업내역을, 재작업 상태에서 수정한 작업내역을 제출할 수 있다. */
function canSubmitWorkLog(user, request) {
  return (
    (request.status === STATUS.ACCEPTED || request.status === STATUS.REWORK) && isAssignedSupporter(user, request)
  );
}

/** 요청서 작성자는 1차 확인 대기 상태에서 작업내역을 승인·반려할 수 있다. */
function canFirstReviewRequest(user, request) {
  return request.status === STATUS.FIRST_REVIEW && request.requesterId === user.id;
}

/** 관리자는 최종 확인 대기 상태에서 작업내역을 승인·반려할 수 있다. */
function canFinalReviewRequest(user, request) {
  return user.role === 'ADMIN' && request.status === STATUS.FINAL_REVIEW;
}

/** 작성자는 완료된 요청서에 만족도를 한 번만 남길 수 있다. (request.rating 이 이미 있으면 불가) */
function canRateRequest(user, request) {
  return request.status === STATUS.COMPLETED && request.requesterId === user.id && !request.rating;
}

/** 작업내역을 제출·재제출하는 이력 종류. 제출 순서가 곧 회차다. */
const SUBMIT_EVENT_TYPES = new Set(['WORK_SUBMIT', 'RESUBMIT']);

/**
 * 이력을 응답용으로 바꾼다. 작업내역 제출 이력에는 몇 회차 제출인지(`round`)를 붙인다.
 * (이력에는 회차 칸이 없어서 제출 이력이 쌓인 순서로 1, 2, 3… 을 매긴다.)
 */
function toEventViews(events = []) {
  let submitCount = 0;
  return events.map((event) => {
    const isSubmit = SUBMIT_EVENT_TYPES.has(event.type);
    if (isSubmit) submitCount += 1;
    return {
      id: event.id,
      type: event.type,
      reason: event.reason ?? null,
      createdAt: event.createdAt,
      actor: event.actor ? { id: event.actor.id, name: event.actor.name } : null,
      ...(isSubmit ? { round: submitCount } : {}),
    };
  });
}

/** 관리자는 제출됨 요청서를 지원자에게 직접 배정할 수 있다. */
function canAssignRequest(user, request) {
  return user.role === 'ADMIN' && request.status === STATUS.SUBMITTED;
}

const toDateOnly = (date) => date.toISOString().slice(0, 10);

/**
 * 응답용 객체로 바꾼다. 보는 사람에 따라 연락처를 가린다.
 * @param {object} request 지원 유형·작성자·담당자 관계가 포함된 Prisma Request
 * @param {{ id: string, role: string }} viewer
 * @param {{ detail?: boolean }} [options] detail이면 본문·연락처 등 상세 항목을 포함한다.
 */
function toRequestView(request, viewer, { detail = false } = {}) {
  const summary = {
    id: request.id,
    title: request.title,
    status: request.status,
    urgency: request.urgency,
    department: request.department,
    // 착수일시부터 희망 완료일까지가 작업을 희망하는 기간이다.
    interviewAt: request.interviewAt,
    desiredDate: toDateOnly(request.desiredDate),
    // 연락 담당자 이름과 전화번호. 전화번호는 볼 수 있는 사람(canSeeContactPhone)에게만 나가고 나머지는 null 이다.
    contactName: request.contactName,
    contactPhone: canSeeContactPhone(viewer, request) ? request.contactPhone : null,
    supportType: request.supportType ? { id: request.supportType.id, name: request.supportType.name } : null,
    requester: request.requester ? { id: request.requester.id, name: request.requester.name } : null,
    assignee: request.assignee ? { id: request.assignee.id, name: request.assignee.name } : null,
    createdAt: request.createdAt,
    canEdit: canEditRequest(viewer, request),
    canAccept: canAcceptRequest(viewer, request),
    canCancelAccept: canCancelAcceptRequest(viewer, request),
    canSubmitWork: canSubmitWorkLog(viewer, request),
    canFirstReview: canFirstReviewRequest(viewer, request),
    canFinalReview: canFinalReviewRequest(viewer, request),
    canAssign: canAssignRequest(viewer, request),
  };
  if (!detail) return summary;

  const seesHistory = canSeeHistory(viewer, request);

  return {
    ...summary,
    content: request.content,
    updatedAt: request.updatedAt,
    completedAt: request.completedAt,
    // 작업내역과 처리 이력은 작성자, 담당 지원자, 관리자에게만 보인다(연락처보다 좁은 범위).
    // 접수 가능 목록을 둘러보는 다른 지원자에게는 이전 담당자·반려 사유가 드러나지 않도록 비워 둔다.
    workLogs: seesHistory
      ? (request.workLogs ?? []).map((log) => ({
          id: log.id,
          round: log.round,
          content: log.content,
          minutes: log.minutes,
          submittedAt: log.submittedAt,
          author: log.author ? { id: log.author.id, name: log.author.name } : null,
        }))
      : [],
    events: seesHistory ? toEventViews(request.events) : [],
    // 만족도: 작성자, 담당 지원자, 관리자에게만 보인다.
    rating:
      seesHistory && request.rating
        ? { score: request.rating.score, comment: request.rating.comment ?? null, createdAt: request.rating.createdAt }
        : null,
    canRate: canRateRequest(viewer, request),
    // 첨부파일: 요청서를 볼 수 있는 사람만, 제출 전 임시 작업내역 첨부는 올린 본인만 본다. 저장소 경로는 내보내지 않는다.
    attachments: seesHistory
      ? (request.attachments ?? [])
          .filter((attachment) => canSeeAttachment(viewer, request, attachment))
          .map((attachment) => toAttachmentView(attachment, request))
      : [],
  };
}

module.exports = {
  buildListWhere,
  canViewRequest,
  canSeeHistory,
  canSeeContactPhone,
  canEditRequest,
  canAcceptRequest,
  canCancelAcceptRequest,
  canSubmitWorkLog,
  canFirstReviewRequest,
  canFinalReviewRequest,
  canAssignRequest,
  canRateRequest,
  toRequestView,
};
