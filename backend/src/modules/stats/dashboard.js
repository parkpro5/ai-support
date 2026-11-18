/**
 * 통계 대시보드(FR-13)의 집계 규칙. 순수 함수만 둔다(DB 접근 금지).
 *
 * 기준
 * - 기간: 이번 달(KST)부터 거슬러 올라간 N개월. 달 경계는 hours.js 와 같은 한국 시간이다.
 * - 처리 건수: 기간 안에 **완료된**(completedAt) 요청서 수. 달은 완료 시각으로 나눈다.
 * - 처리 시간: 요청서 제출(createdAt)부터 최종 확인 완료(completedAt)까지. 재작업으로 걸린 시간도 포함한다.
 * - 평균은 분 단위 정수로 반올림하고, 대상이 없으면 null 이다(0분과 구분).
 * - 평균 만족도는 소수 첫째 자리까지 반올림하고, 평가가 없으면 null 이다.
 */
const { monthOf, recentMonths } = require('./hours');

const DEFAULT_PERIOD_MONTHS = 6;
const MAX_PERIOD_MONTHS = 24;

/** 평균을 분 단위 정수로. 값이 없으면 null. */
function averageMinutes(values) {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

/** 평균 점수를 소수 첫째 자리까지. 값이 없으면 null. */
function averageScore(scores) {
  if (scores.length === 0) return null;
  return Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 10) / 10;
}

/** 제출부터 완료까지 걸린 시간(분). */
function processingMinutes(request) {
  return Math.max(0, Math.round((request.completedAt.getTime() - request.createdAt.getTime()) / 60000));
}

/**
 * 조회 기간의 달 목록. 오래된 달부터 이번 달까지(표·막대를 왼쪽에서 오른쪽으로 읽기 좋게).
 * @param {number} count 개월 수
 * @param {Date} [now]
 */
function periodMonths(count = DEFAULT_PERIOD_MONTHS, now = new Date()) {
  return recentMonths(count, now).reverse();
}

/**
 * 완료된 요청서를 달별로 센다.
 * @param {Array<{ createdAt: Date, completedAt: Date }>} completed 기간 안에 완료된 요청서
 * @param {string[]} months 결과에 담을 달(이 순서대로)
 * @returns {{ completedCount: number, avgProcessingMinutes: number|null, months: Array<{ month: string, completedCount: number, avgProcessingMinutes: number|null }> }}
 */
function summarizeCompleted(completed, months) {
  const byMonth = new Map(months.map((month) => [month, []]));
  for (const request of completed) {
    const bucket = byMonth.get(monthOf(request.completedAt));
    if (bucket) bucket.push(processingMinutes(request));
  }
  const rows = months.map((month) => {
    const minutes = byMonth.get(month);
    return { month, completedCount: minutes.length, avgProcessingMinutes: averageMinutes(minutes) };
  });
  const all = [...byMonth.values()].flat();
  return { completedCount: all.length, avgProcessingMinutes: averageMinutes(all), months: rows };
}

/**
 * 지원 유형별 건수. 요청이 들어온 수(제출 시각이 기간 안)와 완료된 수(완료 시각이 기간 안)를 따로 센다.
 * 사용 중이거나, 기간 안에 활동이 있었던 유형만 담는다. 많이 요청된 순, 같으면 표시 순서·이름 순.
 * @param {Array<{ id: string, name: string, active: boolean, sortOrder: number }>} types
 * @param {Array<{ supportTypeId: string }>} requested 제출 시각이 기간 안인 요청서
 * @param {Array<{ supportTypeId: string }>} completed 완료 시각이 기간 안인 요청서
 */
function countByType(types, requested, completed) {
  const count = (list) => {
    const map = new Map();
    for (const item of list) map.set(item.supportTypeId, (map.get(item.supportTypeId) ?? 0) + 1);
    return map;
  };
  const requestedBy = count(requested);
  const completedBy = count(completed);
  return types
    .map((type) => ({
      id: type.id,
      name: type.name,
      requested: requestedBy.get(type.id) ?? 0,
      completed: completedBy.get(type.id) ?? 0,
      _active: type.active,
      _sortOrder: type.sortOrder,
    }))
    .filter((row) => row._active || row.requested > 0 || row.completed > 0)
    .sort((a, b) => b.requested - a.requested || a._sortOrder - b._sortOrder || a.name.localeCompare(b.name, 'ko'))
    .map(({ _active, _sortOrder, ...row }) => row);
}

/**
 * 지원자별 현황.
 * @param {Array<{ id: string, name: string }>} users 대상 사용자(현재 지원자 + 기간 안에 활동이 있던 사람)
 * @param {Array<{ assigneeId: string, createdAt: Date, completedAt: Date }>} completed 기간 안에 완료된 요청서
 * @param {Array<{ authorId: string, minutes: number }>} workLogs 기간 안에 제출한 작업내역
 * @param {Array<{ assigneeId: string, score: number }>} ratings 기간 안에 완료된 요청서에 달린 평가(담당 지원자 기준)
 */
function summarizeSupporters(users, completed, workLogs, ratings) {
  return users
    .map((user) => {
      const mine = completed.filter((request) => request.assigneeId === user.id);
      const logs = workLogs.filter((log) => log.authorId === user.id);
      const scores = ratings.filter((rating) => rating.assigneeId === user.id).map((rating) => rating.score);
      return {
        id: user.id,
        name: user.name,
        completedCount: mine.length,
        avgProcessingMinutes: averageMinutes(mine.map(processingMinutes)),
        workMinutes: logs.reduce((sum, log) => sum + log.minutes, 0),
        workLogCount: logs.length,
        avgRating: averageScore(scores),
        ratingCount: scores.length,
      };
    })
    .sort((a, b) => b.completedCount - a.completedCount || b.workMinutes - a.workMinutes || a.name.localeCompare(b.name, 'ko'));
}

module.exports = {
  DEFAULT_PERIOD_MONTHS,
  MAX_PERIOD_MONTHS,
  averageMinutes,
  averageScore,
  processingMinutes,
  periodMonths,
  summarizeCompleted,
  countByType,
  summarizeSupporters,
};
