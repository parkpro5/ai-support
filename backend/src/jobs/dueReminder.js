const prisma = require('../config/prismaClient');
const logger = require('../utils/logger');
const { notify } = require('../modules/notifications/notification.service');
const { isReminderTime, tomorrowKstDate } = require('./dueReminderTime');

/**
 * 희망 완료일 하루 전 알림.
 *
 * 외부 스케줄러가 자주(예: 매시간) 호출하므로 같은 요청서에 두 번 보내지 않게 만든다.
 * - 한국 시간(KST) 오전 9시 이후에만 보낸다. 새벽에 울리지 않게 하려는 것이다.
 * - 희망 완료일이 "한국 시간으로 내일"인 요청서만 대상이다. 완료된 요청서는 뺀다.
 * - 보내기 전에 dueReminderSentAt 을 조건부로 채워 선점한다(채운 쪽만 보낸다). 동시에 두 번 실행돼도 한 번만 간다.
 *   대신 보내는 데 실패하면 다시 보내지 않는다(알림은 부가 기능이라 실패는 로그로만 남긴다).
 */

/**
 * @param {Date} [now]
 * @returns {Promise<{ skipped: boolean, found: number, sent: number }>}
 */
async function runDueReminders(now = new Date()) {
  if (!isReminderTime(now)) return { skipped: true, found: 0, sent: 0 };

  const candidates = await prisma.request.findMany({
    where: {
      desiredDate: tomorrowKstDate(now),
      status: { not: 'COMPLETED' },
      dueReminderSentAt: null,
    },
    select: { id: true, title: true, status: true, requesterId: true, assigneeId: true },
  });

  let sent = 0;
  for (const request of candidates) {
    // 선점: 아직 안 보낸 요청서만, 그 사이 상태가 바뀌지 않았을 때만 채운다.
    const { count } = await prisma.request.updateMany({
      where: { id: request.id, dueReminderSentAt: null, status: request.status },
      data: { dueReminderSentAt: now },
    });
    if (count !== 1) continue;
    await notify('DUE_SOON', request, null);
    sent += 1;
  }
  if (candidates.length > 0) logger.info('Due reminders processed', candidates.length, sent);
  return { skipped: false, found: candidates.length, sent };
}

module.exports = { runDueReminders };
