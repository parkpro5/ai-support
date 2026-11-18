// DB 테스트: 전용 테스트 DB에서만 실행된다. (npm run test:db)
// 만족도 평가(FR-12): 작성자만, 완료된 요청서만, 한 번만.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../../app.js';
import factories from '../../test/factories.js';

const { prisma, createUser, createSupportType, createRequest, tokenFor, cleanup } = factories;

let requester;
let otherRequester;
let assignee;
let otherSupporter;
let admin;
let supportType;

const auth = (req, user) => (user ? req.set('Authorization', `Bearer ${tokenFor(user)}`) : req);
const rate = (id, user, body) => auth(request(app).post(`/api/requests/${id}/rating`), user).send(body);
const get = (id, user) => auth(request(app).get(`/api/requests/${id}`), user);
const completed = (overrides = {}) =>
  createRequest({ requester, supportType, assignee, status: 'COMPLETED', completedAt: new Date(), ...overrides });
const ratingsOf = (requestId) => prisma.rating.findMany({ where: { requestId } });

beforeAll(async () => {
  const [{ db }] = await prisma.$queryRaw`select current_database() as db`;
  expect(db.endsWith('_test')).toBe(true);

  [requester, otherRequester, assignee, otherSupporter, admin] = await Promise.all([
    createUser('REQUESTER'),
    createUser('REQUESTER'),
    createUser('SUPPORTER'),
    createUser('SUPPORTER'),
    createUser('ADMIN'),
  ]);
  supportType = await createSupportType();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('POST /api/requests/:id/rating', () => {
  it('작성자가 완료된 요청서에 점수와 후기를 남기면 저장되고 상세에 표시된다', async () => {
    const target = await completed();
    const res = await rate(target.id, requester, { score: 5, comment: '  빠르고 정확했어요  ' });

    expect(res.status).toBe(201);
    expect(res.body.rating).toMatchObject({ score: 5, comment: '빠르고 정확했어요' });
    expect(res.body.canRate).toBe(false);
    const rows = await ratingsOf(target.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ score: 5, comment: '빠르고 정확했어요' });
  });

  it('후기 없이 점수만 남길 수 있다(comment 는 null)', async () => {
    const target = await completed();
    const res = await rate(target.id, requester, { score: 3 });

    expect(res.status).toBe(201);
    expect(res.body.rating).toMatchObject({ score: 3, comment: null });
  });

  it('[완료 조건] 두 번째 입력은 409이고 처음 평가가 그대로 남는다', async () => {
    const target = await completed();
    expect((await rate(target.id, requester, { score: 4, comment: '처음' })).status).toBe(201);

    const second = await rate(target.id, requester, { score: 1, comment: '두 번째' });

    expect(second.status).toBe(409);
    const rows = await ratingsOf(target.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ score: 4, comment: '처음' });
  });

  it('동시에 두 번 보내도 한 번만 저장된다(나머지는 409)', async () => {
    const target = await completed();
    const results = await Promise.all([
      rate(target.id, requester, { score: 5 }),
      rate(target.id, requester, { score: 2 }),
      rate(target.id, requester, { score: 3 }),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect(await ratingsOf(target.id)).toHaveLength(1);
  });

  it.each(['SUBMITTED', 'ACCEPTED', 'FIRST_REVIEW', 'FINAL_REVIEW', 'REWORK'])(
    '[완료 조건] 완료 전(%s) 요청서는 400이고 저장되지 않는다',
    async (status) => {
      const target = await createRequest({ requester, supportType, assignee, status });
      const res = await rate(target.id, requester, { score: 5 });

      expect(res.status).toBe(400);
      expect(await ratingsOf(target.id)).toHaveLength(0);
    },
  );

  it('작성자가 아니면 403: 다른 요청자는 존재를 숨겨 404, 담당 지원자·관리자는 403', async () => {
    const target = await completed();

    expect((await rate(target.id, otherRequester, { score: 5 })).status).toBe(404);
    expect((await rate(target.id, assignee, { score: 5 })).status).toBe(403);
    expect((await rate(target.id, admin, { score: 5 })).status).toBe(403);
    expect(await ratingsOf(target.id)).toHaveLength(0);
  });

  it('작성자가 아닌 사람이 완료 전 요청서에 보내면 400이 아니라 403(작성자 검사가 먼저)', async () => {
    const target = await createRequest({ requester, supportType, assignee, status: 'FIRST_REVIEW' });

    expect((await rate(target.id, assignee, { score: 5 })).status).toBe(403);
    expect((await rate(target.id, admin, { score: 5 })).status).toBe(403);
  });

  it('요청서와 무관한 지원자는 볼 수 없어 404', async () => {
    const target = await completed();
    expect((await rate(target.id, otherSupporter, { score: 5 })).status).toBe(404);
    expect(await ratingsOf(target.id)).toHaveLength(0);
  });

  it('관리자가 작성한 요청서는 그 관리자가 평가할 수 있다', async () => {
    const target = await completed({ requester: admin });
    const res = await rate(target.id, admin, { score: 4 });

    expect(res.status).toBe(201);
  });

  it('로그인 없이는 401', async () => {
    const target = await completed();
    expect((await rate(target.id, null, { score: 5 })).status).toBe(401);
  });

  it('없는 요청서는 404', async () => {
    expect((await rate('00000000-0000-4000-8000-000000000000', requester, { score: 5 })).status).toBe(404);
  });

  it.each([
    ['점수 없음', {}],
    ['0점', { score: 0 }],
    ['6점', { score: 6 }],
    ['소수 점수', { score: 3.5 }],
    ['문자열 점수', { score: '5' }],
    ['여러 줄 후기', { score: 5, comment: '첫 줄\n둘째 줄' }],
    ['너무 긴 후기', { score: 5, comment: 'ㄱ'.repeat(201) }],
  ])('입력 오류(%s)는 400이고 저장되지 않는다', async (_name, body) => {
    const target = await completed();
    const res = await rate(target.id, requester, body);

    expect(res.status).toBe(400);
    expect(await ratingsOf(target.id)).toHaveLength(0);
  });

  it('잘못된 입력으로 400을 받은 뒤에도 올바른 입력으로 남길 수 있다(1회 기회가 소진되지 않는다)', async () => {
    const target = await completed();
    expect((await rate(target.id, requester, { score: 9 })).status).toBe(400);
    expect((await rate(target.id, requester, { score: 5 })).status).toBe(201);
  });
});

describe('상세 응답의 만족도 표시', () => {
  it('작성자·담당 지원자·관리자는 평가를 보고, 무관한 지원자에게는 요청서 자체가 404', async () => {
    const target = await completed();
    await rate(target.id, requester, { score: 4, comment: '좋아요' });

    for (const user of [requester, assignee, admin]) {
      const res = await get(target.id, user);
      expect(res.status).toBe(200);
      expect(res.body.rating).toMatchObject({ score: 4, comment: '좋아요' });
    }
    expect((await get(target.id, otherSupporter)).status).toBe(404);
  });

  it('작성자에게만 canRate 가 true 이고, 평가하면 false 로 바뀐다', async () => {
    const target = await completed();

    expect((await get(target.id, requester)).body.canRate).toBe(true);
    expect((await get(target.id, admin)).body.canRate).toBe(false);
    expect((await get(target.id, assignee)).body.canRate).toBe(false);

    await rate(target.id, requester, { score: 5 });
    expect((await get(target.id, requester)).body.canRate).toBe(false);
  });

  it('평가 전에는 rating 이 null, 완료 전 요청서는 canRate 가 false', async () => {
    const done = await completed();
    const open = await createRequest({ requester, supportType, assignee, status: 'FIRST_REVIEW' });

    expect((await get(done.id, requester)).body.rating).toBeNull();
    expect((await get(open.id, requester)).body.canRate).toBe(false);
  });

  it('요청서를 지우면 평가도 함께 지워진다(고아 행 없음)', async () => {
    const target = await completed();
    await rate(target.id, requester, { score: 5 });
    await prisma.request.delete({ where: { id: target.id } });

    expect(await ratingsOf(target.id)).toHaveLength(0);
  });
});
