// DB 테스트: 전용 테스트 DB에서만 실행된다. (npm run test:db)
// vitest 는 ESM 전용이라 테스트 파일만 import 문법을 쓴다. 소스(CommonJS)는 기본 import 후 구조 분해한다.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../../app.js';
import factories from '../../test/factories.js';

const { prisma, createUser, createSupportType, createRequest, tokenFor, cleanup } = factories;

let requester;
let supporterA;
let supporterB;
let admin;
let supportType;

const post = (path, user) => {
  const req = request(app).post(path);
  return user ? req.set('Authorization', `Bearer ${tokenFor(user)}`) : req;
};
const get = (path, user) => request(app).get(path).set('Authorization', `Bearer ${tokenFor(user)}`);

const newRequest = (overrides = {}) => createRequest({ requester, supportType, ...overrides });
const events = (requestId) => prisma.requestEvent.findMany({ where: { requestId }, orderBy: { createdAt: 'asc' } });
const reload = (id) => prisma.request.findUnique({ where: { id } });

beforeAll(async () => {
  // 안전장치: 앱이 실제로 테스트 DB를 쓰고 있는지 한 번 더 확인한다.
  const [{ db }] = await prisma.$queryRaw`select current_database() as db`;
  expect(db.endsWith('_test')).toBe(true);

  [requester, supporterA, supporterB, admin] = await Promise.all([
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

describe('POST /api/requests/:id/accept', () => {
  it('지원자가 접수하면 접수됨이 되고 담당자와 ACCEPT 이력이 남는다', async () => {
    const target = await newRequest();
    const res = await post(`/api/requests/${target.id}/accept`, supporterA);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ACCEPTED');
    expect(res.body.assignee.id).toBe(supporterA.id);

    const saved = await reload(target.id);
    expect(saved.status).toBe('ACCEPTED');
    expect(saved.assigneeId).toBe(supporterA.id);

    const log = await events(target.id);
    expect(log.map((e) => [e.type, e.actorId])).toEqual([['ACCEPT', supporterA.id]]);
  });

  it('접수한 지원자는 상세에서 연락처를 볼 수 있고, 목록은 내 담당에만 나온다', async () => {
    const target = await newRequest();
    await post(`/api/requests/${target.id}/accept`, supporterA);

    const detail = await get(`/api/requests/${target.id}`, supporterA);
    expect(detail.body.contactPhone).toBe('010-1234-5678');
    expect(detail.body.canCancelAccept).toBe(true);
    expect(detail.body.canAccept).toBe(false);

    const mine = await get('/api/requests?scope=mine&pageSize=100', supporterA);
    expect(mine.body.items.some((i) => i.id === target.id)).toBe(true);
    const available = await get('/api/requests?scope=available&pageSize=100', supporterA);
    expect(available.body.items.some((i) => i.id === target.id)).toBe(false);
    const others = await get('/api/requests?scope=available&pageSize=100', supporterB);
    expect(others.body.items.some((i) => i.id === target.id)).toBe(false);
  });

  it('동시에 두 지원자가 접수하면 정확히 1건만 성공하고 나머지는 409', async () => {
    const target = await newRequest();
    const [a, b] = await Promise.all([
      post(`/api/requests/${target.id}/accept`, supporterA),
      post(`/api/requests/${target.id}/accept`, supporterB),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const winner = a.status === 200 ? supporterA : supporterB;
    expect((await reload(target.id)).assigneeId).toBe(winner.id);

    const log = await events(target.id);
    expect(log).toHaveLength(1);
    expect(log[0].actorId).toBe(winner.id);
  });

  it('여러 번 반복해도 동시 접수는 항상 승자가 한 명이다', async () => {
    const targets = await Promise.all(Array.from({ length: 8 }, () => newRequest()));

    for (const target of targets) {
      const results = await Promise.all([
        post(`/api/requests/${target.id}/accept`, supporterA),
        post(`/api/requests/${target.id}/accept`, supporterB),
        post(`/api/requests/${target.id}/accept`, supporterA),
        post(`/api/requests/${target.id}/accept`, supporterB),
      ]);
      const codes = results.map((r) => r.status);
      expect(codes.filter((c) => c === 200)).toHaveLength(1);
      expect(codes.filter((c) => c === 409)).toHaveLength(3);
      expect(await events(target.id)).toHaveLength(1);
    }
  });

  it('이미 접수된 요청서를 다시 접수하면 409', async () => {
    const target = await newRequest({ status: 'ACCEPTED', assignee: supporterA });
    const res = await post(`/api/requests/${target.id}/accept`, supporterB);
    expect(res.status).toBe(409);
    expect((await reload(target.id)).assigneeId).toBe(supporterA.id);
    expect(await events(target.id)).toHaveLength(0);
  });

  it('요청자와 관리자는 접수할 수 없다(403)', async () => {
    const target = await newRequest();
    expect((await post(`/api/requests/${target.id}/accept`, requester)).status).toBe(403);
    expect((await post(`/api/requests/${target.id}/accept`, admin)).status).toBe(403);
    expect((await reload(target.id)).status).toBe('SUBMITTED');
  });

  it('토큰이 없으면 401, 없는 요청서는 404', async () => {
    const target = await newRequest();
    expect((await post(`/api/requests/${target.id}/accept`)).status).toBe(401);
    expect((await post('/api/requests/does-not-exist/accept', supporterA)).status).toBe(404);
  });

  it('접수와 작성자의 수정이 동시에 일어나도 일관된 결과가 된다', async () => {
    const target = await newRequest({ title: '원래 제목' });
    const [accept, patch] = await Promise.all([
      post(`/api/requests/${target.id}/accept`, supporterA),
      request(app)
        .patch(`/api/requests/${target.id}`)
        .set('Authorization', `Bearer ${tokenFor(requester)}`)
        .send({ title: '바뀐 제목' }),
    ]);

    // 접수는 수정과 상관없이 성공한다. 수정은 접수보다 먼저일 때만 반영되고, 늦으면 409다.
    expect(accept.status).toBe(200);
    const saved = await reload(target.id);
    expect(saved.status).toBe('ACCEPTED');
    expect([200, 409]).toContain(patch.status);
    expect(saved.title).toBe(patch.status === 200 ? '바뀐 제목' : '원래 제목');
  });
});

describe('POST /api/requests/:id/cancel-accept', () => {
  it('담당 지원자가 취소하면 제출됨으로 돌아가고 담당자가 비워지며 이력이 남는다', async () => {
    const target = await newRequest();
    await post(`/api/requests/${target.id}/accept`, supporterA);

    const res = await post(`/api/requests/${target.id}/cancel-accept`, supporterA);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('SUBMITTED');
    expect(res.body.assignee).toBeNull();

    const saved = await reload(target.id);
    expect(saved.status).toBe('SUBMITTED');
    expect(saved.assigneeId).toBeNull();
    expect((await events(target.id)).map((e) => e.type)).toEqual(['ACCEPT', 'CANCEL_ACCEPT']);
  });

  it('취소 후에는 다른 지원자가 다시 접수할 수 있다', async () => {
    const target = await newRequest();
    await post(`/api/requests/${target.id}/accept`, supporterA);
    await post(`/api/requests/${target.id}/cancel-accept`, supporterA);

    const res = await post(`/api/requests/${target.id}/accept`, supporterB);
    expect(res.status).toBe(200);
    expect((await reload(target.id)).assigneeId).toBe(supporterB.id);
    expect((await events(target.id)).map((e) => e.type)).toEqual(['ACCEPT', 'CANCEL_ACCEPT', 'ACCEPT']);
  });

  it('담당이 아닌 지원자와 요청자는 취소할 수 없다(403)', async () => {
    const target = await newRequest({ status: 'ACCEPTED', assignee: supporterA });
    expect((await post(`/api/requests/${target.id}/cancel-accept`, supporterB)).status).toBe(403);
    expect((await post(`/api/requests/${target.id}/cancel-accept`, requester)).status).toBe(403);
    expect((await post(`/api/requests/${target.id}/cancel-accept`, admin)).status).toBe(403);

    const saved = await reload(target.id);
    expect(saved.status).toBe('ACCEPTED');
    expect(saved.assigneeId).toBe(supporterA.id);
  });

  it('접수됨이 아닌 상태에서는 취소할 수 없다(409): 제출됨, 작업내역 제출 후', async () => {
    const submitted = await newRequest();
    expect((await post(`/api/requests/${submitted.id}/cancel-accept`, supporterA)).status).toBe(403);

    for (const status of ['FIRST_REVIEW', 'FINAL_REVIEW', 'REWORK', 'COMPLETED']) {
      const target = await newRequest({ status, assignee: supporterA });
      const res = await post(`/api/requests/${target.id}/cancel-accept`, supporterA);
      expect(res.status, `status=${status}`).toBe(409);
      expect((await reload(target.id)).status).toBe(status);
    }
  });

  it('같은 취소를 동시에 두 번 보내면 한 번만 성공한다', async () => {
    const target = await newRequest({ status: 'ACCEPTED', assignee: supporterA });
    const results = await Promise.all([
      post(`/api/requests/${target.id}/cancel-accept`, supporterA),
      post(`/api/requests/${target.id}/cancel-accept`, supporterA),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await events(target.id)).toHaveLength(1);
  });

  it('취소와 다른 지원자의 접수가 동시에 일어나도 담당자는 한 명이다', async () => {
    const target = await newRequest({ status: 'ACCEPTED', assignee: supporterA });
    const [cancel, accept] = await Promise.all([
      post(`/api/requests/${target.id}/cancel-accept`, supporterA),
      post(`/api/requests/${target.id}/accept`, supporterB),
    ]);

    // B의 접수는 A의 취소가 먼저 반영됐을 때만 성공한다. 그 외에는 A가 담당자로 남는다.
    expect(cancel.status).toBe(200);
    const saved = await reload(target.id);
    if (accept.status === 200) {
      expect(saved).toMatchObject({ status: 'ACCEPTED', assigneeId: supporterB.id });
    } else {
      expect(accept.status).toBe(409);
      expect(saved).toMatchObject({ status: 'SUBMITTED', assigneeId: null });
    }
  });
});
