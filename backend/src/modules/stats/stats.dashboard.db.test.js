// DB 테스트: 전용 테스트 DB에서만 실행된다. (npm run test:db)
// 통계 대시보드(FR-13): 시드 데이터의 수치가 손으로 계산한 값과 일치하고, 관리자만 볼 수 있다.
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import app from '../../app.js';
import factories from '../../test/factories.js';
import hours from './hours.js';

const { prisma, createUser, createSupportType, createRequest, tokenFor, cleanup } = factories;
const { currentMonth, monthRange, recentMonths } = hours;

let requester;
let supporterA;
let supporterB;
let supporterC; // 활동 없는 지원자
let admin;
let typeA;
let typeB;

const call = (path, user) => {
  const req = request(app).get(`/api${path}`);
  if (user) req.set('Authorization', `Bearer ${tokenFor(user)}`);
  return req;
};

const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;

/** 이번 달·지난달·8개월 전 안쪽의 한 시점(한국 시간 달 경계에서 충분히 떨어진 3일 12시). */
function momentIn(monthsAgo) {
  const month = recentMonths(12)[monthsAgo];
  return new Date(monthRange(month).start.getTime() + 3 * 24 * HOUR + 12 * HOUR);
}

/** 완료된 요청서: completedAt 에서 elapsedMinutes 분 전에 제출됐다. */
async function seedCompleted({ type, assignee, completedAt, elapsedMinutes, score, comment = null }) {
  const created = await createRequest({
    requester,
    supportType: type,
    assignee,
    status: 'COMPLETED',
    createdAt: new Date(completedAt.getTime() - elapsedMinutes * MIN),
    completedAt,
  });
  if (score) await prisma.rating.create({ data: { requestId: created.id, score, comment } });
  return created;
}

const seedLog = (target, author, { minutes, round = 1, submittedAt }) =>
  prisma.workLog.create({
    data: { requestId: target.id, authorId: author.id, content: '작업', minutes, round, submittedAt },
  });

beforeEach(async () => {
  [typeA, typeB] = await Promise.all([createSupportType(), createSupportType()]);
  requester = await createUser('REQUESTER');
  supporterA = await createUser('SUPPORTER');
  supporterB = await createUser('SUPPORTER');
  supporterC = await createUser('SUPPORTER');
  admin = await createUser('ADMIN');
});

afterEach(cleanup);

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

/**
 * 시드(손 계산). 기간은 기본 6개월(이번 달 포함)이다.
 *   이번 달 완료: R1 유형A 지원자A 180분(3시간) 평점 5 / R2 유형A 지원자A 300분 평점 4
 *   지난달 완료:  R3 유형B 지원자B 1440분(1일) 평점 없음
 *   기간 밖(8개월 전) 완료: R4 유형A 지원자A 600분 평점 1  → 모든 집계에서 빠져야 한다
 *   이번 달 제출, 진행 중(1차 확인 대기): R5 유형A 지원자A
 * 근로시간: R1 90분, R2 30분(이번 달 제출, 지원자A) / R3 45분(지난달 제출, 지원자B)
 */
async function seed() {
  const thisMonth = momentIn(0);
  const lastMonth = momentIn(1);
  const longAgo = momentIn(8);

  const r1 = await seedCompleted({ type: typeA, assignee: supporterA, completedAt: thisMonth, elapsedMinutes: 180, score: 5, comment: '좋아요' });
  const r2 = await seedCompleted({ type: typeA, assignee: supporterA, completedAt: new Date(thisMonth.getTime() + HOUR), elapsedMinutes: 300, score: 4 });
  const r3 = await seedCompleted({ type: typeB, assignee: supporterB, completedAt: lastMonth, elapsedMinutes: 1440 });
  const r4 = await seedCompleted({ type: typeA, assignee: supporterA, completedAt: longAgo, elapsedMinutes: 600, score: 1 });
  const r5 = await createRequest({ requester, supportType: typeA, assignee: supporterA, status: 'FIRST_REVIEW', createdAt: thisMonth });

  await seedLog(r1, supporterA, { minutes: 90, submittedAt: thisMonth });
  await seedLog(r2, supporterA, { minutes: 30, submittedAt: thisMonth });
  await seedLog(r3, supporterB, { minutes: 45, submittedAt: lastMonth });
  await seedLog(r4, supporterA, { minutes: 999, submittedAt: longAgo });
  return { r1, r2, r3, r4, r5 };
}

describe('GET /api/stats/summary — 요약', () => {
  it('[완료 조건] 시드 데이터의 수치가 손으로 계산한 값과 일치한다', async () => {
    await seed();

    const res = await call('/stats/summary', admin);

    expect(res.status).toBe(200);
    const { body } = res;
    expect(body.periodMonths).toBe(6);
    // 기간 안의 완료: R1, R2, R3 (R4 는 기간 밖)
    expect(body.completedCount).toBe(3);
    // 평균 처리 시간 = (180 + 300 + 1440) / 3 = 640분
    expect(body.avgProcessingMinutes).toBe(640);
    // 평균 만족도 = (5 + 4) / 2 = 4.5 (R3 는 평가 없음, R4 는 기간 밖)
    expect(body.avgRating).toBe(4.5);
    expect(body.ratingCount).toBe(2);

    // 달별: 오래된 달부터, 마지막이 이번 달
    expect(body.months).toHaveLength(6);
    expect(body.months[5]).toEqual({ month: currentMonth(), completedCount: 2, avgProcessingMinutes: 240 });
    expect(body.months[4]).toEqual({ month: recentMonths(6)[1], completedCount: 1, avgProcessingMinutes: 1440 });
    expect(body.months.slice(0, 4).every((row) => row.completedCount === 0 && row.avgProcessingMinutes === null)).toBe(true);
    expect(body.from).toBe(body.months[0].month);
    expect(body.to).toBe(currentMonth());

    // 유형별: 요청 건수(제출 시각이 기간 안) / 완료 건수
    //   유형A 요청: R1·R2·R5 = 3 (R4 는 8개월 전 제출), 완료 2 / 유형B 요청: R3 = 1, 완료 1
    const rowA = body.byType.find((row) => row.id === typeA.id);
    const rowB = body.byType.find((row) => row.id === typeB.id);
    expect(rowA).toMatchObject({ requested: 3, completed: 2 });
    expect(rowB).toMatchObject({ requested: 1, completed: 1 });
    expect(body.requestedCount).toBe(4);
  });

  it('현재 상태별 건수는 기간과 무관한 지금의 모습이다', async () => {
    await seed();

    const { body } = await call('/stats/summary?months=1', admin);

    // 완료 4건(R4 포함) + 1차 확인 대기 1건. 기간을 1개월로 줄여도 바뀌지 않는다.
    expect(body.currentStatus).toMatchObject({ COMPLETED: 4, FIRST_REVIEW: 1, SUBMITTED: 0, ACCEPTED: 0, FINAL_REVIEW: 0, REWORK: 0 });
  });

  it('기간을 1개월로 줄이면 이번 달 완료만 센다', async () => {
    await seed();

    const { body } = await call('/stats/summary?months=1', admin);

    expect(body.periodMonths).toBe(1);
    expect(body.completedCount).toBe(2);
    expect(body.avgProcessingMinutes).toBe(240);
    expect(body.months).toEqual([{ month: currentMonth(), completedCount: 2, avgProcessingMinutes: 240 }]);
    expect(body.byType.find((row) => row.id === typeB.id)).toMatchObject({ requested: 0, completed: 0 });
  });

  it('기간을 12개월로 늘려도 8개월 전 완료(R4)가 들어오고 평균이 바뀐다', async () => {
    await seed();

    const { body } = await call('/stats/summary?months=12', admin);

    expect(body.completedCount).toBe(4);
    // (180 + 300 + 1440 + 600) / 4 = 630
    expect(body.avgProcessingMinutes).toBe(630);
    // (5 + 4 + 1) / 3 = 3.33… → 3.3
    expect(body.avgRating).toBe(3.3);
  });

  it('기간은 완료 시각 기준이다: 오래전에 제출했어도 이번 달에 완료했으면 이번 달에 센다', async () => {
    const nineMonths = 9 * 30 * 24 * 60; // 분
    await seedCompleted({ type: typeA, assignee: supporterA, completedAt: momentIn(0), elapsedMinutes: nineMonths });

    const { body } = await call('/stats/summary?months=1', admin);

    expect(body.completedCount).toBe(1);
    expect(body.avgProcessingMinutes).toBe(nineMonths);
    expect(body.months[0]).toMatchObject({ month: currentMonth(), completedCount: 1 });
    // 제출은 기간 밖이므로 "요청 건수"에는 들어가지 않는다.
    expect(body.byType.find((row) => row.id === typeA.id)).toMatchObject({ requested: 0, completed: 1 });
  });

  it('완료 건이 없으면 평균은 null(0이 아니다)', async () => {
    const { body } = await call('/stats/summary?months=1', admin);

    expect(body.completedCount).toBe(0);
    expect(body.avgProcessingMinutes).toBeNull();
    expect(body.avgRating).toBeNull();
    expect(body.ratingCount).toBe(0);
  });

  it('진행 중인 요청서는 완료 건수·평균 처리 시간에 들어가지 않는다', async () => {
    const open = await createRequest({ requester, supportType: typeA, assignee: supporterA, status: 'FINAL_REVIEW' });
    // 완료 시각이 비어 있는 상태이므로 집계 대상이 아니다.
    expect(open.completedAt).toBeNull();

    const { body } = await call('/stats/summary?months=1', admin);
    expect(body.completedCount).toBe(0);
  });

  it('권한: 로그인 없이 401, 요청자·지원자는 403', async () => {
    expect((await call('/stats/summary')).status).toBe(401);
    expect((await call('/stats/summary', requester)).status).toBe(403);
    expect((await call('/stats/summary', supporterA)).status).toBe(403);
  });

  it.each(['0', '25', '-1', '6.5', 'abc', ''])('기간(months=%j)이 올바르지 않으면 400', async (months) => {
    expect((await call(`/stats/summary?months=${months}`, admin)).status).toBe(400);
  });

  it('금액·시급 같은 값은 응답에 없다(Won\'t)', async () => {
    await seed();
    const { body } = await call('/stats/summary', admin);
    expect(JSON.stringify(body)).not.toMatch(/wage|pay|amount|won|salary|rate\b|cost|금액|시급|급여/i);
  });
});

describe('GET /api/stats/supporters — 지원자별 현황', () => {
  it('[완료 조건] 지원자별 수치가 손으로 계산한 값과 일치한다', async () => {
    await seed();

    const res = await call('/stats/supporters', admin);

    expect(res.status).toBe(200);
    const rowOf = (user) => res.body.supporters.find((row) => row.id === user.id);
    // 지원자A: 기간 안 완료 R1·R2 → 2건, 평균 (180+300)/2 = 240분, 근로 90+30 = 120분(R4의 999분은 기간 밖), 평점 (5+4)/2 = 4.5
    expect(rowOf(supporterA)).toMatchObject({
      completedCount: 2,
      avgProcessingMinutes: 240,
      workMinutes: 120,
      workLogCount: 2,
      avgRating: 4.5,
      ratingCount: 2,
    });
    // 지원자B: 지난달 완료 R3 → 1건, 1440분, 근로 45분, 평가 없음
    expect(rowOf(supporterB)).toMatchObject({
      completedCount: 1,
      avgProcessingMinutes: 1440,
      workMinutes: 45,
      workLogCount: 1,
      avgRating: null,
      ratingCount: 0,
    });
    // 지원자C: 활동 없음
    expect(rowOf(supporterC)).toMatchObject({
      completedCount: 0,
      avgProcessingMinutes: null,
      workMinutes: 0,
      workLogCount: 0,
      avgRating: null,
      ratingCount: 0,
    });
    expect(res.body.periodMonths).toBe(6);
  });

  it('근로시간은 T-15 의 월별 근로시간 합과 같다', async () => {
    await seed();
    const month = currentMonth();

    const dash = await call('/stats/supporters?months=1', admin);
    const hoursRes = await call(`/stats/hours?month=${month}`, admin);

    const fromDash = dash.body.supporters.find((row) => row.id === supporterA.id).workMinutes;
    const fromHours = hoursRes.body.supporters.find((row) => row.id === supporterA.id).minutes;
    expect(fromDash).toBe(120);
    expect(fromDash).toBe(fromHours);
  });

  it('완료 건수 많은 순으로 나온다(A 2건 → B 1건 → C 0건)', async () => {
    await seed();
    const { body } = await call('/stats/supporters', admin);
    const ids = body.supporters.map((row) => row.id);
    expect(ids.indexOf(supporterA.id)).toBeLessThan(ids.indexOf(supporterB.id));
    expect(ids.indexOf(supporterB.id)).toBeLessThan(ids.indexOf(supporterC.id));
  });

  it('요청자·관리자는 나오지 않는다(지원자만)', async () => {
    await seed();
    const ids = (await call('/stats/supporters', admin)).body.supporters.map((row) => row.id);
    expect(ids).not.toContain(requester.id);
    expect(ids).not.toContain(admin.id);
  });

  it('지원자에서 해제된 사람도 기간 안에 활동이 있으면 나온다', async () => {
    await seed();
    await prisma.user.update({ where: { id: supporterB.id }, data: { role: 'REQUESTER' } });

    const { body } = await call('/stats/supporters', admin);

    expect(body.supporters.find((row) => row.id === supporterB.id)).toMatchObject({ completedCount: 1, workMinutes: 45 });
  });

  it('평점은 요청서의 담당 지원자에게 돌아간다(다른 지원자에게 섞이지 않는다)', async () => {
    await seed();
    const { body } = await call('/stats/supporters', admin);
    expect(body.supporters.find((row) => row.id === supporterB.id).ratingCount).toBe(0);
    expect(body.supporters.find((row) => row.id === supporterC.id).ratingCount).toBe(0);
  });

  it('권한: 로그인 없이 401, 요청자·지원자는 403', async () => {
    expect((await call('/stats/supporters')).status).toBe(401);
    expect((await call('/stats/supporters', requester)).status).toBe(403);
    expect((await call('/stats/supporters', supporterA)).status).toBe(403);
  });

  it('기간이 올바르지 않으면 400', async () => {
    expect((await call('/stats/supporters?months=99', admin)).status).toBe(400);
  });
});
