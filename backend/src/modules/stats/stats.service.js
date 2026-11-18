const prisma = require('../../config/prismaClient');
const { RECENT_MONTHS, currentMonth, monthRange, recentMonths, sumByMonth } = require('./hours');
const { countByType, periodMonths, summarizeCompleted, summarizeSupporters, averageScore } = require('./dashboard');

/**
 * 근로시간 = 지원자가 제출한 작업내역의 소요 시간(분)을 더한 값이다.
 * - 재작업으로 여러 번 제출한 작업은 회차마다 따로 센다(그만큼 일을 했기 때문이다).
 * - 요청자·관리자의 확인(승인·반려) 여부와 상관없이 제출한 기록은 모두 센다.
 * - 어느 달에 속하는지는 제출 시각의 한국 시간 기준이다.
 * - 금액은 계산하지 않는다. 시간만 집계한다.
 */

/**
 * 관리자용: 한 달 동안 지원자별로 몇 분을 기록했는지.
 * 지금 지원자인 사람은 기록이 없어도 0분으로 모두 보여주고, 이미 지원자에서 해제됐어도 그 달에 기록이 있으면 포함한다.
 */
async function hoursForAdmin({ month }) {
  const selected = month ?? currentMonth();
  const { start, end } = monthRange(selected);
  const where = { submittedAt: { gte: start, lt: end } };

  const groups = await prisma.workLog.groupBy({
    by: ['authorId'],
    where,
    _sum: { minutes: true },
    _count: { _all: true },
  });
  const byAuthor = new Map(groups.map((group) => [group.authorId, group]));

  const users = await prisma.user.findMany({
    where: { OR: [{ role: 'SUPPORTER' }, { id: { in: groups.map((group) => group.authorId) } }] },
    select: { id: true, name: true },
  });

  const supporters = users
    .map((user) => {
      const group = byAuthor.get(user.id);
      return { id: user.id, name: user.name, minutes: group?._sum.minutes ?? 0, logCount: group?._count._all ?? 0 };
    })
    .sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name, 'ko'));

  return {
    month: selected,
    monthOptions: recentMonths(),
    totalMinutes: supporters.reduce((sum, row) => sum + row.minutes, 0),
    totalLogs: supporters.reduce((sum, row) => sum + row.logCount, 0),
    supporters,
  };
}

/**
 * 지원자 본인용: 최근 12개월의 월별 합계와, 선택한 달의 제출 내역(어느 요청서에 몇 분).
 * 본인이 제출한 작업내역만 다룬다.
 */
async function hoursForSupporter(user, { month }) {
  const selected = month ?? currentMonth();
  const months = recentMonths(RECENT_MONTHS);

  // 월별 합계: 최근 12개월 전체를 한 번에 읽어 월별로 나눈다.
  const oldest = monthRange(months[months.length - 1]).start;
  const newest = monthRange(months[0]).end;
  const logs = await prisma.workLog.findMany({
    where: { authorId: user.id, submittedAt: { gte: oldest, lt: newest } },
    select: { submittedAt: true, minutes: true },
  });

  // 선택한 달의 제출 내역(최근 12개월 밖의 달을 골라도 보여준다).
  const { start, end } = monthRange(selected);
  const entries = await prisma.workLog.findMany({
    where: { authorId: user.id, submittedAt: { gte: start, lt: end } },
    orderBy: [{ submittedAt: 'desc' }, { id: 'asc' }],
    select: {
      id: true,
      round: true,
      minutes: true,
      submittedAt: true,
      request: { select: { id: true, title: true, status: true } },
    },
  });

  return {
    month: selected,
    monthOptions: months,
    totalMinutes: entries.reduce((sum, entry) => sum + entry.minutes, 0),
    totalLogs: entries.length,
    months: sumByMonth(logs, months),
    entries: entries.map((entry) => ({
      id: entry.id,
      requestId: entry.request.id,
      title: entry.request.title,
      requestStatus: entry.request.status,
      round: entry.round,
      minutes: entry.minutes,
      submittedAt: entry.submittedAt,
    })),
  };
}

/** 조회 기간(오래된 달부터 이번 달까지)과 그 기간의 UTC 시작·끝(끝은 포함하지 않음). */
function periodWindow(months) {
  const list = periodMonths(months);
  return { months: list, start: monthRange(list[0]).start, end: monthRange(list[list.length - 1]).end };
}

/**
 * 관리자 대시보드 요약. 기준은 dashboard.js 머리말에 적혀 있다.
 * - months: 달별 완료 건수·평균 처리 시간(오래된 달부터)
 * - byType: 지원 유형별 요청 건수·완료 건수
 * - currentStatus: 지금 요청서가 상태별로 몇 건인지(기간과 무관한 현재 모습)
 */
async function dashboardSummary({ months: periodLength }) {
  const { months, start, end } = periodWindow(periodLength);
  const inWindow = { gte: start, lt: end };

  const [completed, requested, types, ratings, statusGroups] = await Promise.all([
    prisma.request.findMany({
      where: { status: 'COMPLETED', completedAt: inWindow },
      select: { createdAt: true, completedAt: true, supportTypeId: true },
    }),
    prisma.request.findMany({ where: { createdAt: inWindow }, select: { supportTypeId: true } }),
    prisma.supportType.findMany({ select: { id: true, name: true, active: true, sortOrder: true } }),
    prisma.rating.findMany({
      where: { request: { status: 'COMPLETED', completedAt: inWindow } },
      select: { score: true },
    }),
    prisma.request.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);

  const summary = summarizeCompleted(completed, months);
  const statusCounts = Object.fromEntries(statusGroups.map((group) => [group.status, group._count._all]));

  return {
    periodMonths: months.length,
    from: months[0],
    to: months[months.length - 1],
    completedCount: summary.completedCount,
    avgProcessingMinutes: summary.avgProcessingMinutes,
    avgRating: averageScore(ratings.map((rating) => rating.score)),
    ratingCount: ratings.length,
    requestedCount: requested.length,
    months: summary.months,
    byType: countByType(types, requested, completed),
    currentStatus: {
      SUBMITTED: 0,
      ACCEPTED: 0,
      FIRST_REVIEW: 0,
      FINAL_REVIEW: 0,
      REWORK: 0,
      COMPLETED: 0,
      ...statusCounts,
    },
  };
}

/**
 * 관리자 대시보드: 지원자별 현황. 지금 지원자인 사람은 기록이 없어도 0으로 모두 보여주고,
 * 지원자에서 해제됐어도 기간 안에 완료·작업내역·평가가 있으면 포함한다.
 * 근로시간은 T-15 와 같은 기준(제출 시각, KST)이다.
 */
async function dashboardSupporters({ months: periodLength }) {
  const { months, start, end } = periodWindow(periodLength);
  const inWindow = { gte: start, lt: end };

  const [completed, workLogs, ratings] = await Promise.all([
    prisma.request.findMany({
      where: { status: 'COMPLETED', completedAt: inWindow, assigneeId: { not: null } },
      select: { assigneeId: true, createdAt: true, completedAt: true },
    }),
    prisma.workLog.findMany({ where: { submittedAt: inWindow }, select: { authorId: true, minutes: true } }),
    prisma.rating.findMany({
      where: { request: { status: 'COMPLETED', completedAt: inWindow, assigneeId: { not: null } } },
      select: { score: true, request: { select: { assigneeId: true } } },
    }),
  ]);

  const ratingRows = ratings.map((rating) => ({ assigneeId: rating.request.assigneeId, score: rating.score }));
  const activeIds = new Set([
    ...completed.map((request) => request.assigneeId),
    ...workLogs.map((log) => log.authorId),
  ]);
  const users = await prisma.user.findMany({
    where: { OR: [{ role: 'SUPPORTER' }, { id: { in: [...activeIds] } }] },
    select: { id: true, name: true },
  });

  return {
    periodMonths: months.length,
    from: months[0],
    to: months[months.length - 1],
    supporters: summarizeSupporters(users, completed, workLogs, ratingRows),
  };
}

module.exports = { hoursForAdmin, hoursForSupporter, dashboardSummary, dashboardSupporters };
