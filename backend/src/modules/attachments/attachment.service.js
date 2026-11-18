const crypto = require('crypto');
const prisma = require('../../config/prismaClient');
const ApiError = require('../../utils/ApiError');
const logger = require('../../utils/logger');
const { STATUS } = require('../requests/stateMachine');
const { getStorage } = require('./storage.service');
const {
  ALLOWED_TYPES,
  MAX_FILE_BYTES,
  MAX_FILES_PER_TARGET,
  DOWNLOAD_URL_TTL_SECONDS,
  buildStoragePath,
  extensionOf,
  isStoragePathForRequest,
  sanitizeFileName,
  validateFile,
} = require('./attachment.rules');
const {
  TARGETS,
  canAttach,
  canDeleteAttachment,
  canSeeAttachment,
  kindOf,
  toAttachmentView,
} = require('./attachment.policy');

const REQUEST_SELECT = { id: true, status: true, requesterId: true, assigneeId: true };

async function loadRequestOrThrow(id) {
  const request = await prisma.request.findUnique({ where: { id }, select: REQUEST_SELECT });
  if (!request) throw new ApiError(404, '요청서를 찾을 수 없습니다');
  return request;
}

/** 올릴 수 없는 이유를 구분한다: 권한이 없으면 403, 권한은 있으나 지금 상태에서는 안 되면 409. */
function denialFor(user, request, target) {
  if (target === TARGETS.REQUEST) {
    if (request.requesterId !== user.id) return new ApiError(403, '요청서 작성자만 첨부파일을 올릴 수 있습니다');
    return new ApiError(409, '제출됨 상태의 요청서에만 첨부파일을 올릴 수 있습니다');
  }
  const assigned = user.role === 'SUPPORTER' && request.assigneeId === user.id;
  if (!assigned) return new ApiError(403, '담당 지원자만 작업내역 첨부파일을 올릴 수 있습니다');
  return new ApiError(409, '접수됨 또는 재작업 상태에서만 작업내역 첨부파일을 올릴 수 있습니다');
}

function assertCanAttach(user, request, target) {
  if (!canAttach(user, request, target)) throw denialFor(user, request, target);
}

/** 같은 대상에 이미 올려 둔(작업내역에 묶이기 전의) 파일 수. */
function countExisting(user, request, target) {
  return prisma.attachment.count({
    where: {
      requestId: request.id,
      workLogId: null,
      uploaderId: target === TARGETS.REQUEST ? request.requesterId : user.id,
    },
  });
}

async function assertUnderLimit(user, request, target) {
  if ((await countExisting(user, request, target)) >= MAX_FILES_PER_TARGET) {
    throw new ApiError(409, `첨부파일은 최대 ${MAX_FILES_PER_TARGET}개까지 올릴 수 있습니다`);
  }
}

/** 저장소에서 파일을 지운다. 실패해도 본 처리에는 영향을 주지 않고 로그만 남긴다(남은 파일은 나중에 정리할 수 있다). */
async function removeObjectsQuietly(paths) {
  if (paths.length === 0) return;
  try {
    await getStorage().removeObjects(paths);
  } catch (err) {
    logger.error('Attachment cleanup failed:', paths.length, err && err.message);
  }
}

/**
 * 브라우저가 파일을 직접 올릴 서명 주소를 발급한다. (아직 DB에는 아무것도 저장하지 않는다.)
 * 검사 순서: 요청서(404) → 권한(403)·상태(409) → 파일 형식·크기(400) → 개수(409) → 저장소 설정(503)
 */
async function issueUploadUrl(user, requestId, { target, fileName, size }) {
  const request = await loadRequestOrThrow(requestId);
  assertCanAttach(user, request, target);

  const checked = validateFile({ fileName, size });
  if (!checked.ok) throw new ApiError(400, checked.message, { [checked.field]: checked.message });
  await assertUnderLimit(user, request, target);

  const storage = getStorage();
  const path = buildStoragePath(requestId, checked.ext, crypto.randomUUID());
  const { url } = await storage.createUploadUrl(path);
  return {
    uploadUrl: url,
    path,
    contentType: checked.contentType,
    maxBytes: MAX_FILE_BYTES,
    // 브라우저가 업로드할 때 그대로 보낼 헤더. 같은 경로에 덮어쓰지 못하게 한다.
    headers: { 'content-type': checked.contentType, 'x-upsert': 'false', 'cache-control': 'max-age=3600' },
  };
}

/**
 * 업로드를 마친 파일을 등록한다. 클라이언트가 말한 크기를 믿지 않고 저장소에서 실제 크기를 읽어 확인한다.
 * 형식·크기가 어긋난 파일은 저장소에서도 지운다.
 */
async function registerAttachment(user, requestId, { target, path, fileName }) {
  const request = await loadRequestOrThrow(requestId);
  assertCanAttach(user, request, target);

  if (!isStoragePathForRequest(path, requestId)) {
    const message = '이 요청서용으로 올린 파일이 아닙니다';
    throw new ApiError(400, message, { path: message });
  }
  const cleanName = sanitizeFileName(fileName);
  if (!cleanName || extensionOf(cleanName) !== extensionOf(path)) {
    const message = '파일 이름의 확장자가 올린 파일과 다릅니다';
    throw new ApiError(400, message, { fileName: message });
  }
  await assertUnderLimit(user, request, target);

  const storage = getStorage();
  const info = await storage.getObjectInfo(path);
  if (!info) {
    const message = '업로드된 파일을 찾을 수 없습니다. 다시 올려 주세요';
    throw new ApiError(400, message, { path: message });
  }
  if (info.size <= 0 || info.size > MAX_FILE_BYTES) {
    await removeObjectsQuietly([path]);
    const message = info.size <= 0 ? '빈 파일은 올릴 수 없습니다' : `파일 크기는 ${MAX_FILE_BYTES / (1024 * 1024)}MB 이하여야 합니다`;
    throw new ApiError(400, message, { size: message });
  }

  try {
    const created = await prisma.attachment.create({
      data: {
        requestId,
        uploaderId: user.id,
        storagePath: path,
        fileName: cleanName,
        size: info.size,
        // 형식은 클라이언트가 보낸 값이 아니라 확장자로 정한 표준 값을 저장한다.
        mime: ALLOWED_TYPES[extensionOf(path)],
      },
      include: { uploader: { select: { id: true, name: true } } },
    });
    return toAttachmentView(created, request);
  } catch (err) {
    if (err && err.code === 'P2002') throw new ApiError(409, '이미 등록된 파일입니다');
    throw err;
  }
}

async function loadAttachmentOrThrow(id) {
  const attachment = await prisma.attachment.findUnique({
    where: { id },
    include: { request: { select: REQUEST_SELECT } },
  });
  if (!attachment) throw new ApiError(404, '첨부파일을 찾을 수 없습니다');
  return attachment;
}

/** 내려받기용 서명 주소(60초). 요청서를 볼 수 있는 사람만, 임시 작업내역 첨부는 올린 본인만 받을 수 있다. */
async function createDownloadUrl(user, attachmentId) {
  const attachment = await loadAttachmentOrThrow(attachmentId);
  if (!canSeeAttachment(user, attachment.request, attachment)) {
    throw new ApiError(403, '이 첨부파일을 내려받을 권한이 없습니다');
  }
  const { url } = await getStorage().createDownloadUrl(attachment.storagePath, attachment.fileName, DOWNLOAD_URL_TTL_SECONDS);
  return { url, expiresIn: DOWNLOAD_URL_TTL_SECONDS, fileName: attachment.fileName };
}

/** 올린 본인이 아직 바꿀 수 있는 상태에서만 삭제한다. 제출된 작업내역에 묶인 파일은 지울 수 없다. */
async function deleteAttachment(user, attachmentId) {
  const attachment = await loadAttachmentOrThrow(attachmentId);
  const { request } = attachment;

  if (!canSeeAttachment(user, request, attachment) || attachment.uploaderId !== user.id) {
    throw new ApiError(403, '올린 사람만 첨부파일을 삭제할 수 있습니다');
  }
  if (!canDeleteAttachment(user, request, attachment)) {
    throw new ApiError(409, '이미 제출되어 첨부파일을 삭제할 수 없습니다');
  }

  // 삭제 조건에 "아직 작업내역에 묶이지 않음"과 요청서 상태를 함께 걸어, 확인 사이에 제출·접수가 끝난 경우를 막는다.
  const kind = kindOf(attachment, request);
  const { count } = await prisma.attachment.deleteMany({
    where: {
      id: attachmentId,
      workLogId: null,
      request: kind === 'request' ? { status: STATUS.SUBMITTED } : { status: { in: [STATUS.ACCEPTED, STATUS.REWORK] } },
    },
  });
  if (count !== 1) throw new ApiError(409, '이미 제출되어 첨부파일을 삭제할 수 없습니다');

  await removeObjectsQuietly([attachment.storagePath]);
}

module.exports = {
  issueUploadUrl,
  registerAttachment,
  createDownloadUrl,
  deleteAttachment,
  removeObjectsQuietly,
};
