const { runDueReminders } = require('./dueReminder');

/**
 * 주기 작업 진입점. 외부 스케줄러(cron-job.org 등)가 POST /api/cron/reminders 로 호출한다.
 * 현재 하는 일: 희망 완료일 하루 전 알림(한국 시간 오전 9시 이후, 요청서당 한 번).
 * @param {Date} [now] 테스트에서 시각을 정해 줄 때만 쓴다.
 */
async function runOnce(now = new Date()) {
  return runDueReminders(now);
}

module.exports = { runOnce };
