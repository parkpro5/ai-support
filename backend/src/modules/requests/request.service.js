const prisma = require('../../config/prismaClient');
const ApiError = require('../../utils/ApiError');
const { STATUS, ACTION, TransitionError, transition } = require('./stateMachine');
const { buildListWhere, canViewRequest, toRequestView } = require('./request.policy');
const { notify } = require('../notifications/notification.service');
const { removeObjectsQuietly } = require('../attachments/attachment.service');

const INCLUDE = {
  supportType: { select: { id: true, name: true } },
  requester: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true } },
};

const WORK_LOG_INCLUDE = {
  orderBy: { round: 'asc' },
  include: { author: { select: { id: true, name: true } } },
};

// 이력은 시간순. 같은 시각이면 id로 순서를 고정한다.
const ATTACHMENT_INCLUDE = {
  orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  include: { uploader: { select: { id: true, name: true } } },
};

const EVENT_INCLUDE = {
  orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  include: { actor: { select: { id: true, name: true } } },
};

/** 지원 유형이 존재하고 사용 중인지 확인한다. */
async function assertActiveSupportType(supportTypeId) {
  const type = await prisma.supportType.findFirst({ where: { id: supportTypeId, active: true } });
  if (!type) {
    throw new ApiError(400, '사용할 수 없는 지원 유형입니다', { supportTypeId: '사용할 수 없는 지원 유형입니다' });
  }
}

/**
 * 조회 권한이 없는 요청서는 존재 자체를 숨기기 위해 404로 응답한다.
 * @returns 지원 유형·작성자·담당자가 포함된 요청서
 */
async function findViewableOrThrow(user, id, { withHistory = false } = {}) {
  const request = await prisma.request.findUnique({
    where: { id },
    include: withHistory
      ? { ...INCLUDE, workLogs: WORK_LOG_INCLUDE, events: EVENT_INCLUDE, attachments: ATTACHMENT_INCLUDE, rating: true }
      : INCLUDE,
  });
  if (!request || !canViewRequest(user, request)) {
    throw new ApiError(404, '요청서를 찾을 수 없습니다');
  }
  return request;
}

/** 수정·삭제 공통 검사: 조회 권한(404) → 작성자(403) → 제출됨 상태(409). */
async function findEditableOrThrow(user, id) {
  const request = await findViewableOrThrow(user, id);
  if (request.requesterId !== user.id) {
    throw new ApiError(403, '작성자만 수정하거나 삭제할 수 있습니다');
  }
  if (request.status !== STATUS.SUBMITTED) {
    throw new ApiError(409, '제출됨 상태의 요청서만 수정하거나 삭제할 수 있습니다');
  }
  return request;
}

async function listRequests(user, { status, scope, page, pageSize }) {
  const where = buildListWhere(user, { status, scope });
  const [rows, total] = await prisma.$transaction([
    prisma.request.findMany({
      where,
      include: INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.request.count({ where }),
  ]);
  return { items: rows.map((row) => toRequestView(row, user)), page, pageSize, total };
}

async function getRequest(user, id) {
  const request = await findViewableOrThrow(user, id, { withHistory: true });
  return toRequestView(request, user, { detail: true });
}

/**
 * 새 요청서 작성 화면의 기본값.
 * - contactName: 로그인한 Google 계정의 이름.
 * - department: 이 사람이 가장 최근에 작성한 요청서의 소속(처음이면 null).
 *   Google 로그인으로는 이름과 이메일만 얻을 수 있고 부서 정보는 얻을 수 없어서, 한 번 입력한 소속을 기억해 둔다.
 * 화면은 이 값을 채워 주기만 하고 작성자가 언제든 고칠 수 있다.
 */
async function getFormDefaults(user) {
  const [profile, latest] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: { name: true } }),
    prisma.request.findFirst({
      where: { requesterId: user.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      select: { department: true },
    }),
  ]);
  return { contactName: profile?.name ?? '', department: latest?.department ?? null };
}

/** 요청서를 제출됨 상태로 만들고 SUBMIT 이력을 같은 트랜잭션에 남긴다. */
async function createRequest(user, data) {
  await assertActiveSupportType(data.supportTypeId);
  const created = await prisma.$transaction(async (tx) => {
    const request = await tx.request.create({
      data: { ...data, requesterId: user.id, status: STATUS.SUBMITTED },
      include: INCLUDE,
    });
    await tx.requestEvent.create({
      data: { requestId: request.id, actorId: user.id, type: 'SUBMIT' },
    });
    return request;
  });
  // 상태 변경이 커밋된 뒤에 알린다. 알림 실패는 이 요청의 결과에 영향을 주지 않는다.
  await notify('SUBMIT', created, user.id);
  return toRequestView(created, user, { detail: true });
}

async function updateRequest(user, id, data) {
  const current = await findEditableOrThrow(user, id);
  // 지원 유형을 바꿀 때만 사용 가능한지 본다. 이미 비활성화된 유형의 요청서도 다른 항목은 고칠 수 있어야 한다.
  if (data.supportTypeId && data.supportTypeId !== current.supportTypeId) {
    await assertActiveSupportType(data.supportTypeId);
  }

  // 검사와 갱신 사이에 접수되는 경우를 막기 위해 갱신 조건에도 상태를 건다.
  // 희망 완료일을 바꾸면 "하루 전 알림"을 새 날짜에 맞춰 다시 보낼 수 있도록 보낸 기록을 비운다.
  const changes = data.desiredDate !== undefined ? { ...data, dueReminderSentAt: null } : data;
  const { count } = await prisma.request.updateMany({
    where: { id, requesterId: user.id, status: STATUS.SUBMITTED },
    data: changes,
  });
  if (count !== 1) {
    throw new ApiError(409, '이미 접수되어 수정할 수 없습니다');
  }
  return getRequest(user, id);
}

async function deleteRequest(user, id) {
  await findEditableOrThrow(user, id);
  // 요청서를 지우면 첨부 기록은 함께 지워지지만 저장소의 파일은 남으므로, 지우기 전에 경로를 모아 둔다.
  const files = await prisma.attachment.findMany({ where: { requestId: id }, select: { storagePath: true } });
  const { count } = await prisma.request.deleteMany({
    where: { id, requesterId: user.id, status: STATUS.SUBMITTED },
  });
  if (count !== 1) {
    throw new ApiError(409, '이미 접수되어 삭제할 수 없습니다');
  }
  await removeObjectsQuietly(files.map((file) => file.storagePath));
}

const TRANSITION_MESSAGES = {
  [ACTION.ACCEPT]: {
    FORBIDDEN: '지원자만 요청서를 접수할 수 있습니다',
    INVALID_STATE: '이미 접수되었거나 접수할 수 없는 요청서입니다',
  },
  [ACTION.WORK_SUBMIT]: {
    FORBIDDEN: '담당 지원자만 작업내역을 제출할 수 있습니다',
    INVALID_STATE: '접수됨 또는 재작업 상태에서만 작업내역을 제출할 수 있습니다',
  },
  [ACTION.RESUBMIT]: {
    FORBIDDEN: '담당 지원자만 작업내역을 제출할 수 있습니다',
    INVALID_STATE: '접수됨 또는 재작업 상태에서만 작업내역을 제출할 수 있습니다',
  },
  [ACTION.ASSIGN]: {
    FORBIDDEN: '관리자만 지원자를 배정할 수 있습니다',
    INVALID_STATE: '제출됨 상태의 요청서만 배정할 수 있습니다',
  },
  [ACTION.FIRST_APPROVE]: {
    FORBIDDEN: '요청서 작성자만 1차 확인을 할 수 있습니다',
    INVALID_STATE: '1차 확인 대기 상태에서만 확인할 수 있습니다',
  },
  [ACTION.FIRST_REJECT]: {
    FORBIDDEN: '요청서 작성자만 1차 확인을 할 수 있습니다',
    INVALID_STATE: '1차 확인 대기 상태에서만 확인할 수 있습니다',
    REASON_REQUIRED: '반려 사유를 입력해 주세요',
  },
  [ACTION.FINAL_APPROVE]: {
    FORBIDDEN: '관리자만 최종 확인을 할 수 있습니다',
    INVALID_STATE: '최종 확인 대기 상태에서만 확인할 수 있습니다',
  },
  [ACTION.FINAL_REJECT]: {
    FORBIDDEN: '관리자만 최종 확인을 할 수 있습니다',
    INVALID_STATE: '최종 확인 대기 상태에서만 확인할 수 있습니다',
    REASON_REQUIRED: '반려 사유를 입력해 주세요',
  },
  [ACTION.CANCEL_ACCEPT]: {
    FORBIDDEN: '담당 지원자만 접수를 취소할 수 있습니다',
    INVALID_STATE: '접수됨 상태에서만 접수를 취소할 수 있습니다',
  },
};

/**
 * 상태 전이 규칙을 적용하고, 거부되면 사용자에게 보여줄 한국어 메시지의 ApiError로 바꿔 던진다.
 * (TransitionError의 statusCode는 그대로 유지한다.)
 * @returns {{ status: string, eventType: string }}
 */
function applyTransition(request, action, user, payload) {
  try {
    return transition(request, action, user, payload);
  } catch (err) {
    if (err instanceof TransitionError) {
      throw new ApiError(err.statusCode, TRANSITION_MESSAGES[action]?.[err.code] ?? err.message);
    }
    throw err;
  }
}

async function findForTransitionOrThrow(id) {
  const request = await prisma.request.findUnique({
    where: { id },
    select: { id: true, title: true, status: true, requesterId: true, assigneeId: true },
  });
  if (!request) throw new ApiError(404, '요청서를 찾을 수 없습니다');
  return request;
}

/**
 * 지원자가 요청서를 접수한다(선착순 단독).
 * 상태를 읽은 뒤 갱신하기까지 사이에 다른 지원자가 먼저 접수할 수 있으므로,
 * 갱신 조건에 `status = SUBMITTED`를 걸고 반영된 행이 1건일 때만 성공으로 본다.
 * 진 쪽은 409이며, 상태 변경과 이력 기록은 한 트랜잭션이다.
 */
async function acceptRequest(user, id) {
  const request = await findForTransitionOrThrow(id);
  const next = applyTransition(request, ACTION.ACCEPT, user);

  await prisma.$transaction(async (tx) => {
    const { count } = await tx.request.updateMany({
      where: { id, status: STATUS.SUBMITTED },
      data: { status: next.status, assigneeId: user.id },
    });
    if (count !== 1) {
      throw new ApiError(409, TRANSITION_MESSAGES[ACTION.ACCEPT].INVALID_STATE);
    }
    await tx.requestEvent.create({
      data: { requestId: id, actorId: user.id, type: next.eventType },
    });
  });
  await notify(next.eventType, { ...request, assigneeId: user.id }, user.id);
  return getRequest(user, id);
}

/** 담당 지원자가 접수를 취소한다. 요청서는 제출됨으로 돌아가고 담당자가 비워진다. */
async function cancelAcceptRequest(user, id) {
  const request = await findForTransitionOrThrow(id);
  const next = applyTransition(request, ACTION.CANCEL_ACCEPT, user);

  await prisma.$transaction(async (tx) => {
    const { count } = await tx.request.updateMany({
      where: { id, status: STATUS.ACCEPTED, assigneeId: user.id },
      data: { status: next.status, assigneeId: null },
    });
    if (count !== 1) {
      throw new ApiError(409, TRANSITION_MESSAGES[ACTION.CANCEL_ACCEPT].INVALID_STATE);
    }
    await tx.requestEvent.create({
      data: { requestId: id, actorId: user.id, type: next.eventType },
    });
  });
  return getRequest(user, id);
}

/**
 * 담당 지원자가 작업내역을 제출한다. 요청서는 1차 확인 대기가 된다.
 * - 접수됨(ACCEPTED): 첫 제출. 1회차 작업내역을 만들고 WORK_SUBMIT 이력을 남긴다.
 * - 재작업(REWORK): 반려된 뒤의 재제출. 이전 회차는 그대로 두고 다음 회차를 추가하며 RESUBMIT 이력을 남긴다.
 *   재제출은 확인을 처음부터 다시 받는다(항상 1차 확인 대기).
 * 상태·담당자를 갱신 조건에 걸어 같은 제출이 두 번 들어와도 한 번만 반영하고,
 * 상태 변경·작업내역 저장·이력 기록은 한 트랜잭션이라 일부만 반영되는 일이 없다.
 */
async function submitWorkLog(user, id, { content, minutes }) {
  const request = await findForTransitionOrThrow(id);
  const resubmitting = request.status === STATUS.REWORK;
  const action = resubmitting ? ACTION.RESUBMIT : ACTION.WORK_SUBMIT;
  const next = applyTransition(request, action, user);
  const fromStatus = resubmitting ? STATUS.REWORK : STATUS.ACCEPTED;

  await prisma.$transaction(async (tx) => {
    const { count } = await tx.request.updateMany({
      where: { id, status: fromStatus, assigneeId: user.id },
      data: { status: next.status },
    });
    if (count !== 1) {
      throw new ApiError(409, TRANSITION_MESSAGES[action].INVALID_STATE);
    }

    // 첫 제출은 항상 1회차(같은 회차가 이미 있으면 유일 제약이 막는다). 재제출은 마지막 회차 + 1.
    let round = 1;
    if (resubmitting) {
      const { _max } = await tx.workLog.aggregate({ where: { requestId: id }, _max: { round: true } });
      round = (_max.round ?? 0) + 1;
    }
    const workLog = await tx.workLog.create({
      data: { requestId: id, authorId: user.id, content, minutes, round },
    });
    // 이 지원자가 미리 올려 둔(아직 작업내역에 묶이지 않은) 첨부파일을 이번 제출에 묶는다.
    await tx.attachment.updateMany({
      where: { requestId: id, uploaderId: user.id, workLogId: null },
      data: { workLogId: workLog.id },
    });
    await tx.requestEvent.create({
      data: { requestId: id, actorId: user.id, type: next.eventType },
    });
  });
  await notify(next.eventType, { ...request, assigneeId: user.id }, user.id);
  return getRequest(user, id);
}

/**
 * 확인 단계별 규칙. 1차 확인(작성자)과 최종 확인(관리자)은 같은 방식으로 처리하되 아래만 다르다.
 * - from: 확인할 수 있는 상태
 * - approve / reject: 상태 전이 행동
 * - extraWhere: 갱신 조건에 더 걸 항목(1차는 작성자 본인)
 * - approveData: 승인할 때 함께 바꿀 값(최종 승인은 완료 시각)
 */
const REVIEW_STAGES = {
  FIRST: {
    from: STATUS.FIRST_REVIEW,
    approve: ACTION.FIRST_APPROVE,
    reject: ACTION.FIRST_REJECT,
    extraWhere: (user) => ({ requesterId: user.id }),
    approveData: () => ({}),
  },
  FINAL: {
    from: STATUS.FINAL_REVIEW,
    approve: ACTION.FINAL_APPROVE,
    reject: ACTION.FINAL_REJECT,
    extraWhere: () => ({}),
    approveData: () => ({ completedAt: new Date() }),
  },
};

/**
 * 작업내역을 승인하거나 반려한다.
 * - 반려(사유 필수): 재작업(REWORK)이 되고, 담당 지원자와 작업내역은 그대로 남는다.
 * 상태(와 단계별 조건)를 갱신 조건에 걸어 승인과 반려가 겹치거나 같은 요청이 두 번 들어와도 하나만 반영하고,
 * 상태 변경과 이력(사유 포함) 기록은 한 트랜잭션이다.
 * @param {keyof typeof REVIEW_STAGES} stageName
 * @param {{ decision: 'APPROVE'|'REJECT', reason?: string }} review
 */
async function reviewAtStage(stageName, user, id, { decision, reason }) {
  const stage = REVIEW_STAGES[stageName];
  const approving = decision === 'APPROVE';
  const action = approving ? stage.approve : stage.reject;
  const request = await findForTransitionOrThrow(id);
  const next = applyTransition(request, action, user, { reason });

  await prisma.$transaction(async (tx) => {
    const { count } = await tx.request.updateMany({
      where: { id, status: stage.from, ...stage.extraWhere(user) },
      data: { status: next.status, ...(approving ? stage.approveData() : {}) },
    });
    if (count !== 1) {
      throw new ApiError(409, TRANSITION_MESSAGES[action].INVALID_STATE);
    }
    await tx.requestEvent.create({
      data: {
        requestId: id,
        actorId: user.id,
        type: next.eventType,
        reason: approving ? null : reason.trim(),
      },
    });
  });
  await notify(next.eventType, request, user.id);
  return getRequest(user, id);
}

/** 요청서 작성자의 1차 확인. 승인하면 최종 확인 대기(FINAL_REVIEW)가 된다. */
const reviewFirst = (user, id, review) => reviewAtStage('FIRST', user, id, review);

/** 관리자의 최종 확인. 승인하면 완료(COMPLETED)가 되고 완료 시각이 기록된다. */
const reviewFinal = (user, id, review) => reviewAtStage('FINAL', user, id, review);

/**
 * 관리자가 제출됨 요청서를 지원자에게 직접 배정한다. 요청서는 접수됨이 되고 담당자가 정해지며 ASSIGN 이력이 남는다.
 * 접수와 같은 방식으로 갱신 조건에 `status = SUBMITTED`를 걸어, 지원자가 먼저 접수했거나 배정이 겹치면 409다.
 * 배정받은 지원자는 접수한 것과 같은 상태가 되므로 작업내역을 제출하거나 접수를 취소할 수 있다.
 * @param {{ supporterId: string }} body 지원자로 지정된 사용자만 배정할 수 있다(그 외는 400).
 */
async function assignRequest(user, id, { supporterId }) {
  const request = await findForTransitionOrThrow(id);
  const next = applyTransition(request, ACTION.ASSIGN, user);

  const supporter = await prisma.user.findUnique({ where: { id: supporterId }, select: { id: true, role: true } });
  if (!supporter || supporter.role !== 'SUPPORTER') {
    const message = '지원자로 지정된 사용자만 배정할 수 있습니다';
    throw new ApiError(400, message, { supporterId: message });
  }

  await prisma.$transaction(async (tx) => {
    const { count } = await tx.request.updateMany({
      where: { id, status: STATUS.SUBMITTED },
      data: { status: next.status, assigneeId: supporter.id },
    });
    if (count !== 1) {
      throw new ApiError(409, TRANSITION_MESSAGES[ACTION.ASSIGN].INVALID_STATE);
    }
    await tx.requestEvent.create({
      data: { requestId: id, actorId: user.id, type: next.eventType },
    });
  });
  await notify(next.eventType, { ...request, assigneeId: supporter.id }, user.id);
  return getRequest(user, id);
}

/**
 * 완료된 요청서에 작성자가 만족도(1~5점, 한 줄 후기)를 남긴다. 한 요청서에 한 번만.
 * 검사 순서: 조회 권한(404) → 작성자(403) → 완료 상태(400) → 이미 평가함(409).
 * 중복은 요청서마다 하나뿐인 DB 유일 제약으로 막아서, 동시에 두 번 보내도 한 번만 저장된다.
 */
async function rateRequest(user, id, { score, comment }) {
  const request = await findViewableOrThrow(user, id);
  if (request.requesterId !== user.id) {
    throw new ApiError(403, '요청서 작성자만 만족도를 남길 수 있습니다');
  }
  if (request.status !== STATUS.COMPLETED) {
    throw new ApiError(400, '완료된 요청서에만 만족도를 남길 수 있습니다');
  }
  try {
    await prisma.rating.create({ data: { requestId: id, score, comment } });
  } catch (err) {
    if (err && err.code === 'P2002') throw new ApiError(409, '이미 만족도를 남긴 요청서입니다');
    throw err;
  }
  return getRequest(user, id);
}

module.exports = {
  listRequests,
  getFormDefaults,
  getRequest,
  createRequest,
  updateRequest,
  deleteRequest,
  acceptRequest,
  cancelAcceptRequest,
  submitWorkLog,
  reviewFirst,
  reviewFinal,
  assignRequest,
  rateRequest,
};
