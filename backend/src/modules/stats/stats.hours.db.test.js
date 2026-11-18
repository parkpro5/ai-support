// DB 테스트: 전용 테스트 DB에서만 실행된다. (npm run test:db)
// 근로시간 집계(FR-11): 지원자별·월별 합계, 본인 화면, 권한, 한국 시간 월 경계.
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import app from '../../app.js';
import factories from '../../test/factories.js';

const { prisma, createUser, createSupportType, createRequest, tokenFor, cleanup } = factories;

let requester;
let supporterA;
let supporterB;
let admin;
let supportType;

const call = (path, user) => {
  const req = request(app).get(`/api${path}`);
  if (user) req.set('Authorization', `Bearer ${tokenFor(user)}`);
  return req;
};

/** 작업내역을 직접 심는다. 같은 요청서에 회차를 올리면 재작업 재제출이다. */
async function seedLog(req, author, { minutes, round = 1, submittedAt }) {
  return prisma.workLog.create({
    data: { requestId: req.id, authorId: author.id, content: '작업 내용', minutes, round, submittedAt: new Date(submittedAt) },
  });
}

const newRequest = (assignee, overrides = {}) => createRequest({ requester, supportType, assignee, ...overrides });

beforeEach(async () => {
  supportType = await createSupportType();
  requester = await createUser('REQUESTER');
  supporterA = await createUser('SUPPORTER');
  supporterB = await createUser('SUPPORTER');
  admin = await createUser('ADMIN');
});

// 요청서를 지우면 딸린 작업내역도 함께 지워진다.
afterEach(cleanup);

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

// 이 테스트의 기준 달: 2026-11 (한국 시간)
const MONTH = '2026-11';
const IN_NOV_A = '2026-11-05T03:00:00.000Z';
const IN_NOV_B = '2026-11-20T03:00:00.000Z';

describe('GET /api/stats/my-hours — 지원자 본인', () => {
  it('[완료 조건] 시드한 두 건의 합계가 월 누적과 일치한다', async () => {
    const r1 = await newRequest(supporterA);
    const r2 = await newRequest(supporterA);
    await seedLog(r1, supporterA, { minutes: 90, submittedAt: IN_NOV_A });
    await seedLog(r2, supporterA, { minutes: 30, submittedAt: IN_NOV_B });

    const res = await call(`/stats/my-hours?month=${MONTH}`, supporterA);

    expect(res.status).toBe(200);
    expect(res.body.month).toBe(MONTH);
    expect(res.body.totalMinutes).toBe(120);
    expect(res.body.totalLogs).toBe(2);
    expect(res.body.entries.map((e) => e.minutes).sort()).toEqual([30, 90]);
    // 월별 합계 표의 해당 달도 같은 값이어야 한다.
    expect(res.body.months.find((row) => row.month === MONTH)).toEqual({ month: MONTH, minutes: 120, logCount: 2 });
    // 관리자 현황의 같은 사람 합계와도 같아야 한다.
    const adminRes = await call(`/stats/hours?month=${MONTH}`, admin);
    expect(adminRes.body.supporters.find((s) => s.id === supporterA.id)).toMatchObject({ minutes: 120, logCount: 2 });
  });

  it('요청서 제목·회차·요청 상태와 함께 최근 제출 순으로 돌려준다', async () => {
    const r1 = await newRequest(supporterA, { title: '먼저 한 작업' });
    const r2 = await newRequest(supporterA, { title: '나중 작업' });
    await seedLog(r1, supporterA, { minutes: 90, submittedAt: IN_NOV_A });
    await seedLog(r2, supporterA, { minutes: 30, submittedAt: IN_NOV_B });

    const { body } = await call(`/stats/my-hours?month=${MONTH}`, supporterA);

    expect(body.entries.map((e) => e.title)).toEqual(['나중 작업', '먼저 한 작업']);
    expect(body.entries[0]).toMatchObject({ requestId: r2.id, round: 1, minutes: 30 });
    expect(body.entries[0]).toHaveProperty('requestStatus');
    expect(body.entries[0]).toHaveProperty('submittedAt');
  });

  it('다른 지원자의 기록은 합치지 않는다', async () => {
    const mine = await newRequest(supporterA);
    const theirs = await newRequest(supporterB);
    await seedLog(mine, supporterA, { minutes: 60, submittedAt: IN_NOV_A });
    await seedLog(theirs, supporterB, { minutes: 500, submittedAt: IN_NOV_A });

    const { body } = await call(`/stats/my-hours?month=${MONTH}`, supporterA);

    expect(body.totalMinutes).toBe(60);
    expect(body.totalLogs).toBe(1);
    expect(body.entries).toHaveLength(1);
    expect(body.months.reduce((sum, row) => sum + row.minutes, 0)).toBe(60);
  });

  it('재작업으로 재제출한 회차도 각각 센다', async () => {
    const r = await newRequest(supporterA);
    await seedLog(r, supporterA, { minutes: 60, round: 1, submittedAt: IN_NOV_A });
    await seedLog(r, supporterA, { minutes: 45, round: 2, submittedAt: IN_NOV_B });

    const { body } = await call(`/stats/my-hours?month=${MONTH}`, supporterA);

    expect(body.totalMinutes).toBe(105);
    expect(body.entries.map((e) => e.round).sort()).toEqual([1, 2]);
  });

  it('요청서 상태(확인 전·승인·반려 후 재작업 등)와 상관없이 제출한 기록은 센다', async () => {
    const waiting = await newRequest(supporterA, { status: 'FIRST_REVIEW' });
    const done = await newRequest(supporterA, { status: 'COMPLETED' });
    await seedLog(waiting, supporterA, { minutes: 40, submittedAt: IN_NOV_A });
    await seedLog(done, supporterA, { minutes: 20, submittedAt: IN_NOV_B });

    const { body } = await call(`/stats/my-hours?month=${MONTH}`, supporterA);

    expect(body.totalMinutes).toBe(60);
  });

  it('월 경계는 한국 시간: 11/30 23:59:59(KST)는 11월, 12/1 00:00:00(KST)는 12월', async () => {
    const a = await newRequest(supporterA);
    const b = await newRequest(supporterA);
    await seedLog(a, supporterA, { minutes: 10, submittedAt: '2026-11-30T14:59:59.999Z' });
    await seedLog(b, supporterA, { minutes: 20, submittedAt: '2026-11-30T15:00:00.000Z' });
    // 11월 첫 순간(KST 11/1 00:00)도 11월이다.
    const c = await newRequest(supporterA);
    await seedLog(c, supporterA, { minutes: 5, submittedAt: '2026-10-31T15:00:00.000Z' });

    const nov = await call('/stats/my-hours?month=2026-11', supporterA);
    const dec = await call('/stats/my-hours?month=2026-12', supporterA);

    expect(nov.body.totalMinutes).toBe(15);
    expect(dec.body.totalMinutes).toBe(20);
  });

  it('월별 합계는 최근 12개월을 최신순으로 보여주고, 월을 안 고르면 이번 달', async () => {
    const { body } = await call('/stats/my-hours', supporterA);

    expect(body.months).toHaveLength(12);
    expect(body.monthOptions).toHaveLength(12);
    expect(body.month).toBe(body.monthOptions[0]);
    expect(body.months[0].month).toBe(body.month);
    expect(body.totalMinutes).toBe(0);
    expect(body.entries).toEqual([]);
  });

  it('최근 12개월 밖의 달을 골라도 그 달의 내역은 보여준다', async () => {
    const r = await newRequest(supporterA);
    await seedLog(r, supporterA, { minutes: 75, submittedAt: '2024-03-10T03:00:00.000Z' });

    const { body } = await call('/stats/my-hours?month=2024-03', supporterA);

    expect(body.totalMinutes).toBe(75);
    expect(body.entries).toHaveLength(1);
  });

  it('금액·시급 같은 값은 응답에 없다(Won\'t)', async () => {
    const r = await newRequest(supporterA);
    await seedLog(r, supporterA, { minutes: 60, submittedAt: IN_NOV_A });

    const { body } = await call(`/stats/my-hours?month=${MONTH}`, supporterA);

    expect(JSON.stringify(body)).not.toMatch(/wage|pay|amount|won|salary|rate|cost|금액|시급|급여/i);
  });

  it('권한: 로그인 없이 401, 요청자·관리자는 403', async () => {
    expect((await call('/stats/my-hours')).status).toBe(401);
    expect((await call('/stats/my-hours', requester)).status).toBe(403);
    expect((await call('/stats/my-hours', admin)).status).toBe(403);
  });

  it('월 형식이 틀리면 400', async () => {
    const res = await call('/stats/my-hours?month=2026-13', supporterA);
    expect(res.status).toBe(400);
  });
});

describe('GET /api/stats/hours — 관리자 지원자별 현황', () => {
  it('[완료 조건] 지원자별 월 합계가 시드한 기록의 합과 같고, 전체 합계도 같다', async () => {
    const r1 = await newRequest(supporterA);
    const r2 = await newRequest(supporterA);
    const r3 = await newRequest(supporterB);
    await seedLog(r1, supporterA, { minutes: 90, submittedAt: IN_NOV_A });
    await seedLog(r2, supporterA, { minutes: 30, submittedAt: IN_NOV_B });
    await seedLog(r3, supporterB, { minutes: 50, submittedAt: IN_NOV_A });

    const res = await call(`/stats/hours?month=${MONTH}`, admin);

    expect(res.status).toBe(200);
    const rowA = res.body.supporters.find((s) => s.id === supporterA.id);
    const rowB = res.body.supporters.find((s) => s.id === supporterB.id);
    expect(rowA).toMatchObject({ minutes: 120, logCount: 2 });
    expect(rowB).toMatchObject({ minutes: 50, logCount: 1 });
    // 테스트 DB 에 다른 데이터가 없다는 전제: 전체 합계는 행들의 합과 같다.
    expect(res.body.totalMinutes).toBe(res.body.supporters.reduce((sum, row) => sum + row.minutes, 0));
    expect(res.body.totalLogs).toBe(res.body.supporters.reduce((sum, row) => sum + row.logCount, 0));
  });

  it('재작업으로 재제출한 회차도 지원자 합계에 각각 더한다', async () => {
    const r = await newRequest(supporterA);
    await seedLog(r, supporterA, { minutes: 60, round: 1, submittedAt: IN_NOV_A });
    await seedLog(r, supporterA, { minutes: 45, round: 2, submittedAt: IN_NOV_B });

    const { body } = await call(`/stats/hours?month=${MONTH}`, admin);

    expect(body.supporters.find((s) => s.id === supporterA.id)).toMatchObject({ minutes: 105, logCount: 2 });
  });

  it('근로시간 많은 순으로 정렬한다', async () => {
    const r1 = await newRequest(supporterA);
    const r2 = await newRequest(supporterB);
    await seedLog(r1, supporterA, { minutes: 10, submittedAt: IN_NOV_A });
    await seedLog(r2, supporterB, { minutes: 200, submittedAt: IN_NOV_A });

    const { body } = await call(`/stats/hours?month=${MONTH}`, admin);

    const ids = body.supporters.map((s) => s.id);
    expect(ids.indexOf(supporterB.id)).toBeLessThan(ids.indexOf(supporterA.id));
  });

  it('기록이 없는 지원자도 0분으로 보인다', async () => {
    const { body } = await call(`/stats/hours?month=${MONTH}`, admin);

    expect(body.supporters.find((s) => s.id === supporterA.id)).toMatchObject({ minutes: 0, logCount: 0 });
    expect(body.supporters.find((s) => s.id === supporterB.id)).toMatchObject({ minutes: 0, logCount: 0 });
  });

  it('요청자·관리자는 현황에 나오지 않는다(지원자만)', async () => {
    const { body } = await call(`/stats/hours?month=${MONTH}`, admin);

    const ids = body.supporters.map((s) => s.id);
    expect(ids).not.toContain(requester.id);
    expect(ids).not.toContain(admin.id);
  });

  it('지원자에서 해제된 사람도 그 달에 기록이 있으면 보인다', async () => {
    const r = await newRequest(supporterA);
    await seedLog(r, supporterA, { minutes: 60, submittedAt: IN_NOV_A });
    await prisma.user.update({ where: { id: supporterA.id }, data: { role: 'REQUESTER' } });

    const { body } = await call(`/stats/hours?month=${MONTH}`, admin);

    expect(body.supporters.find((s) => s.id === supporterA.id)).toMatchObject({ minutes: 60 });
  });

  it('다른 달의 기록은 섞이지 않는다', async () => {
    const r1 = await newRequest(supporterA);
    const r2 = await newRequest(supporterA);
    await seedLog(r1, supporterA, { minutes: 60, submittedAt: IN_NOV_A });
    await seedLog(r2, supporterA, { minutes: 999, submittedAt: '2026-10-15T03:00:00.000Z' });

    const { body } = await call(`/stats/hours?month=${MONTH}`, admin);

    expect(body.supporters.find((s) => s.id === supporterA.id)).toMatchObject({ minutes: 60, logCount: 1 });
  });

  it('월 경계는 한국 시간', async () => {
    const a = await newRequest(supporterA);
    const b = await newRequest(supporterA);
    await seedLog(a, supporterA, { minutes: 10, submittedAt: '2026-11-30T14:59:59.999Z' });
    await seedLog(b, supporterA, { minutes: 20, submittedAt: '2026-11-30T15:00:00.000Z' });

    const nov = await call('/stats/hours?month=2026-11', admin);
    const dec = await call('/stats/hours?month=2026-12', admin);

    expect(nov.body.supporters.find((s) => s.id === supporterA.id).minutes).toBe(10);
    expect(dec.body.supporters.find((s) => s.id === supporterA.id).minutes).toBe(20);
  });

  it('월을 안 고르면 이번 달이고 선택지는 12개월', async () => {
    const { body } = await call('/stats/hours', admin);

    expect(body.monthOptions).toHaveLength(12);
    expect(body.month).toBe(body.monthOptions[0]);
  });

  it('금액·시급 같은 값은 응답에 없다(Won\'t)', async () => {
    const r = await newRequest(supporterA);
    await seedLog(r, supporterA, { minutes: 60, submittedAt: IN_NOV_A });

    const { body } = await call(`/stats/hours?month=${MONTH}`, admin);

    expect(JSON.stringify(body)).not.toMatch(/wage|pay|amount|won|salary|rate|cost|금액|시급|급여/i);
  });

  it('권한: 로그인 없이 401, 요청자·지원자는 403', async () => {
    expect((await call('/stats/hours')).status).toBe(401);
    expect((await call('/stats/hours', requester)).status).toBe(403);
    expect((await call('/stats/hours', supporterA)).status).toBe(403);
  });

  it('월 형식이 틀리면 400', async () => {
    expect((await call('/stats/hours?month=2026-13', admin)).status).toBe(400);
    expect((await call('/stats/hours?month=abc', admin)).status).toBe(400);
  });
});
