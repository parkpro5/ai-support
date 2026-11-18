/**
 * 근로시간 집계에 쓰는 월(月) 계산. 순수 함수만 둔다(DB 접근 금지).
 *
 * 월은 **한국 시간(KST, UTC+9)** 기준이다. 서버는 UTC로 시각을 저장하므로 UTC 기준으로 자르면
 * 한국 시각 매월 1일 0~9시에 제출한 작업이 전달에 들어간다. 한국은 일광절약시간이 없어 +9시간 고정 오프셋으로 충분하다.
 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;
/** 월 선택지로 보여주는 최근 개월 수. */
const RECENT_MONTHS = 12;

const pad = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM' 문자열을 { year, month }로. 형식이 아니거나 범위 밖이면 null. */
function parseMonth(value) {
  if (typeof value !== 'string') return null;
  const match = MONTH_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  if (year < MIN_YEAR || year > MAX_YEAR) return null;
  return { year, month: Number(match[2]) };
}

/**
 * 그 달(KST)의 시작과 끝(다음 달 시작)을 UTC 시각으로 돌려준다. 구간은 [start, end)다.
 * @param {string} value 'YYYY-MM'
 * @returns {{ start: Date, end: Date }}
 */
function monthRange(value) {
  const parsed = parseMonth(value);
  if (!parsed) throw new RangeError(`Invalid month: ${value}`);
  const start = new Date(Date.UTC(parsed.year, parsed.month - 1, 1) - KST_OFFSET_MS);
  const end = new Date(Date.UTC(parsed.year, parsed.month, 1) - KST_OFFSET_MS);
  return { start, end };
}

/** 이 시각이 한국 시간으로 몇 년 몇 월인지 'YYYY-MM'. */
function monthOf(date) {
  const kst = new Date(date.getTime() + KST_OFFSET_MS);
  return `${kst.getUTCFullYear()}-${pad(kst.getUTCMonth() + 1)}`;
}

/** 이번 달(KST). */
function currentMonth(now = new Date()) {
  return monthOf(now);
}

/** 이번 달부터 거슬러 올라간 n개월의 'YYYY-MM' 목록(최신이 앞). */
function recentMonths(count = RECENT_MONTHS, now = new Date()) {
  let { year, month } = parseMonth(currentMonth(now));
  const months = [];
  for (let i = 0; i < count; i += 1) {
    months.push(`${year}-${pad(month)}`);
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return months;
}

/**
 * 작업내역들을 월별로 합산한다. months에 없는 달의 기록은 무시하고, 기록이 없는 달은 0으로 채운다.
 * @param {Array<{ submittedAt: Date, minutes: number }>} logs
 * @param {string[]} months 결과에 담을 월 목록(이 순서대로)
 * @returns {Array<{ month: string, minutes: number, logCount: number }>}
 */
function sumByMonth(logs, months) {
  const totals = new Map(months.map((month) => [month, { month, minutes: 0, logCount: 0 }]));
  for (const log of logs) {
    const entry = totals.get(monthOf(log.submittedAt));
    if (entry) {
      entry.minutes += log.minutes;
      entry.logCount += 1;
    }
  }
  return months.map((month) => totals.get(month));
}

module.exports = {
  KST_OFFSET_MS,
  RECENT_MONTHS,
  parseMonth,
  monthRange,
  monthOf,
  currentMonth,
  recentMonths,
  sumByMonth,
};
