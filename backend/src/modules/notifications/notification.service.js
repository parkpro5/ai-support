const prisma = require('../../config/prismaClient');
const logger = require('../../utils/logger');
const pushService = require('../push/push.service');
const { buildNotification, resolveRecipients } = require('./notification.events');

/** 알림 전송을 기다리는 최대 시간. 응답이 이 때문에 길어지지 않게 한다. 넘으면 기다리지 않고 진행한다. */
const NOTIFY_WAIT_MS = 4000;

/** promise를 최대 ms만 기다린다. 시간이 지나도 promise 자체는 계속 진행된다. */
function waitAtMost(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve('timeout'), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function userIdsWithRoles(roles) {
  if (!roles || roles.length === 0) return [];
  const users = await prisma.user.findMany({ where: { role: { in: roles } }, select: { id: true } });
  return users.map((user) => user.id);
}

/**
 * 요청서 상태 변화를 관련자의 기기에 푸시로 알린다.
 * **절대 예외를 던지지 않는다.** 알림은 부가 기능이라, 어떤 이유로든 실패해도 이미 끝난 본 처리
 * (접수·제출·확인 등)의 응답과 결과에 영향을 주면 안 된다. 실패는 로그로만 남긴다.
 * 상태 변경이 커밋된 뒤에 호출해야 한다.
 *
 * @param {string} eventType RequestEventType 값 (알림 대상이 아닌 값이면 아무것도 하지 않는다)
 * @param {{ id: string, title: string, requesterId: string, assigneeId?: string|null }} request
 * @param {string} actorId 행동한 사용자. 본인에게는 알리지 않는다.
 */
async function notify(eventType, request, actorId) {
  try {
    const built = buildNotification(eventType, request);
    if (!built) return;

    const roleUserIds = await userIdsWithRoles(built.audience.roles);
    const recipients = resolveRecipients(built.audience, roleUserIds, actorId);
    if (recipients.length === 0) return;

    const result = await waitAtMost(pushService.sendToUsers(recipients, built.payload), NOTIFY_WAIT_MS);
    if (result === 'timeout') logger.warn('Notification is slow; continuing without waiting', eventType, request.id);
  } catch (err) {
    logger.error('Notification failed:', eventType, request && request.id, err && err.message);
  }
}

module.exports = { notify, NOTIFY_WAIT_MS };
