/**
 * 주기 작업 진입점. 외부 스케줄러(cron-job.org 등)가 POST /api/cron/reminders 로 호출한다.
 * 현재는 수행할 작업이 없다. 알림 발송(T-13)과 헬스체크(T-19) 때 채운다.
 */
async function runOnce() {}

module.exports = { runOnce };
