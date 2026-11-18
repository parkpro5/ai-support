/**
 * 첨부파일의 권한과 노출 규칙. 순수 함수만 둔다(DB 접근 금지).
 *
 * 두 종류의 첨부가 있다.
 * - 요청서 첨부(`request`): 작성자가 올린 것. 작성자가 수정할 수 있는 동안(제출됨)만 추가·삭제한다.
 * - 작업내역 첨부(`work`): 담당 지원자가 올린 것. 접수됨·재작업 상태에서 먼저 올려 두면(workLogId 없음 = 임시),
 *   작업내역을 제출할 때 그 제출에 묶인다(workLogId 채워짐). 제출 전의 임시 파일은 올린 본인에게만 보인다.
 */
const { STATUS } = require('../requests/stateMachine');

const TARGETS = Object.freeze({ REQUEST: 'request', WORK: 'work' });

/** 이 요청서에 이 종류의 파일을 올릴 수 있는 사람과 상태인지. */
function canAttach(user, request, target) {
  if (target === TARGETS.REQUEST) {
    return request.requesterId === user.id && request.status === STATUS.SUBMITTED;
  }
  if (target === TARGETS.WORK) {
    return (
      user.role === 'SUPPORTER' &&
      request.assigneeId != null &&
      request.assigneeId === user.id &&
      (request.status === STATUS.ACCEPTED || request.status === STATUS.REWORK)
    );
  }
  return false;
}

/** 첨부가 어느 종류인지. 작업내역에 묶였거나 작성자가 아닌 사람이 올렸으면 작업내역 첨부다. */
function kindOf(attachment, request) {
  if (attachment.workLogId != null) return 'work';
  return attachment.uploaderId === request.requesterId ? 'request' : 'pendingWork';
}

/**
 * 첨부를 볼 수 있는지(목록 표시·다운로드 공통).
 * 요청서의 처리 이력을 볼 수 있는 사람(작성자, 담당 지원자, 관리자)만 보고,
 * 아직 제출되지 않은 임시 작업내역 첨부는 올린 본인만 본다.
 */
function canSeeAttachment(viewer, request, attachment) {
  const seesHistory =
    viewer.role === 'ADMIN' ||
    request.requesterId === viewer.id ||
    (request.assigneeId != null && request.assigneeId === viewer.id);
  if (!seesHistory) return false;
  if (kindOf(attachment, request) === 'pendingWork') return attachment.uploaderId === viewer.id;
  return true;
}

/** 삭제는 올린 본인이, 아직 바꿀 수 있는 상태에서만 할 수 있다. 제출된 작업내역에 묶인 파일은 지우지 못한다. */
function canDeleteAttachment(user, request, attachment) {
  if (attachment.uploaderId !== user.id) return false;
  const kind = kindOf(attachment, request);
  if (kind === 'request') return canAttach(user, request, TARGETS.REQUEST);
  if (kind === 'pendingWork') return canAttach(user, request, TARGETS.WORK);
  return false;
}

/** 응답용 객체. 저장소 경로 같은 내부 값은 내보내지 않는다. */
function toAttachmentView(attachment, request) {
  return {
    id: attachment.id,
    fileName: attachment.fileName,
    size: attachment.size,
    mime: attachment.mime,
    createdAt: attachment.createdAt,
    workLogId: attachment.workLogId ?? null,
    kind: kindOf(attachment, request),
    uploader: attachment.uploader ? { id: attachment.uploader.id, name: attachment.uploader.name } : null,
  };
}

module.exports = { TARGETS, canAttach, kindOf, canSeeAttachment, canDeleteAttachment, toAttachmentView };
