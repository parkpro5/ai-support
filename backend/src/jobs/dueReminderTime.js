const { KST_OFFSET_MS } = require('../modules/stats/hours');

/** 희망 완료일 하루 전 알림의 시간 계산. 순수 함수만 둔다(DB·전송 접근 금지). */

const REMINDER_HOUR_KST = 9;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 이 시각의 한국 시간 시(0~23). */
function kstHour(now) {
  return new Date(now.getTime() + KST_OFFSET_MS).getUTCHours();
}

/** 지금 알림을 보낼 시간대인가. */
function isReminderTime(now) {
  return kstHour(now) >= REMINDER_HOUR_KST;
}

/**
 * 한국 시간 기준 "내일"의 날짜. 희망 완료일(@db.Date)과 같은 형태(UTC 자정)로 돌려준다.
 * 예) 한국 11월 19일 오후 → 11월 20일 00:00 UTC
 */
function tomorrowKstDate(now) {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const todayUtcMidnight = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate());
  return new Date(todayUtcMidnight + DAY_MS);
}

module.exports = { isReminderTime, tomorrowKstDate, kstHour, REMINDER_HOUR_KST };
