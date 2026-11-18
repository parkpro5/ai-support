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

const call = (method, path, user, body) => {
  const req = request(app)[method](`/api${path}`);
  if (user) req.set('Authorization', `Bearer ${tokenFor(user)}`);
  return body ? req.send(body) : req;
};
const assign = (id, user, supporter) =>
  call('post', `/requests/${id}/assign`, user, supporter === undefined ? {} : { supporterId: supporter?.id ?? supporter });

const submitted = (overrides = {}) => createRequest({ requester, supportType, ...overrides });
const events = (requestId) =>
  prisma.requestEvent.findMany({ where: { requestId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
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

describe('POST /api/requests/:id/assign: 배정', () => {
  it('관리자가 제출됨 요청서를 배정하면 접수됨이 되고 담당 지원자와 ASSIGN 이력이 남는다', async () => {
    const target = await submitted();
    const res = await assign(target.id, admin, supporterA);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ACCEPTED', assignee: { id: supporterA.id }, canAssign: false });

    const saved = await reload(target.id);
    expect(saved).toMatchObject({ status: 'ACCEPTED', assigneeId: supporterA.id });
    expect((await events(target.id)).map((e) => [e.type, e.actorId])).toEqual([['ASSIGN', admin.id]]);
  });

  it('배정받은 지원자는 목록의 내 담당에서 보고 연락처도 볼 수 있다', async () => {
    const target = await submitted();
    await assign(target.id, admin, supporterA);

    const mine = await call('get', '/requests?scope=mine&pageSize=100', supporterA);
    expect(mine.body.items.some((i) => i.id === target.id)).toBe(true);
    const detail = await call('get', `/requests/${target.id}`, supporterA);
    expect(detail.body.contactPhone).toBe('010-1234-5678');
    expect(detail.body.events.map((e) => e.type)).toEqual(['ASSIGN']);
  });

  it('접수 가능 목록에서 사라지고 다른 지원자는 접수할 수 없다', async () => {
    const target = await submitted();
    await assign(target.id, admin, supporterA);

    const available = await call('get', '/requests?scope=available&pageSize=100', supporterB);
    expect(available.body.items.some((i) => i.id === target.id)).toBe(false);
    expect((await call('post', `/requests/${target.id}/accept`, supporterB)).status).toBe(409);
  });

  it('배정받은 지원자는 접수한 것과 같이 작업내역을 제출할 수 있다', async () => {
    const target = await submitted();
    await assign(target.id, admin, supporterA);

    const res = await call('post', `/requests/${target.id}/work-logs`, supporterA, { content: '작업함', minutes: 10 });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('FIRST_REVIEW');
    expect((await events(target.id)).map((e) => e.type)).toEqual(['ASSIGN', 'WORK_SUBMIT']);
  });

  it('배정받은 지원자가 접수를 취소하면 제출됨으로 돌아가 다시 배정할 수 있다', async () => {
    const target = await submitted();
    await assign(target.id, admin, supporterA);

    const cancelled = await call('post', `/requests/${target.id}/cancel-accept`, supporterA);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({ status: 'SUBMITTED', assignee: null, canAssign: false });

    const again = await assign(target.id, admin, supporterB);
    expect(again.status).toBe(200);
    expect((await reload(target.id)).assigneeId).toBe(supporterB.id);
    expect((await events(target.id)).map((e) => e.type)).toEqual(['ASSIGN', 'CANCEL_ACCEPT', 'ASSIGN']);
  });

  it('요청자도 배정 사실을 처리 이력에서 볼 수 있다', async () => {
    const target = await submitted();
    await assign(target.id, admin, supporterA);
    const detail = await call('get', `/requests/${target.id}`, requester);
    expect(detail.body.events.map((e) => [e.type, e.actor.id])).toEqual([['ASSIGN', admin.id]]);
  });
});

describe('POST /api/requests/:id/assign: 검증과 권한', () => {
  it('지원자가 아닌 사용자는 배정할 수 없다(400): 요청자, 관리자, 없는 id', async () => {
    for (const bad of [requester, admin, 'does-not-exist']) {
      const target = await submitted();
      const res = await assign(target.id, admin, bad);

      expect(res.status).toBe(400);
      expect(res.body.error.details).toHaveProperty('supporterId');
      expect((await reload(target.id)).status).toBe('SUBMITTED');
      expect(await events(target.id)).toHaveLength(0);
    }
  });

  it('지원자 id가 없으면 400', async () => {
    const target = await submitted();
    const res = await assign(target.id, admin);
    expect(res.status).toBe(400);
    expect(res.body.error.details).toHaveProperty('supporterId');
  });

  it('제출됨이 아닌 요청서는 배정할 수 없다(409)', async () => {
    for (const status of ['ACCEPTED', 'FIRST_REVIEW', 'FINAL_REVIEW', 'REWORK', 'COMPLETED']) {
      const target = await submitted({ status, assignee: supporterA });
      const res = await assign(target.id, admin, supporterB);

      expect(res.status, status).toBe(409);
      expect((await reload(target.id)).assigneeId).toBe(supporterA.id);
      expect(await events(target.id)).toHaveLength(0);
    }
  });

  it('관리자가 아니면 배정할 수 없다(403): 요청자, 지원자 — 없는 요청서에도 403', async () => {
    const target = await submitted();
    for (const user of [requester, supporterA, supporterB]) {
      expect((await assign(target.id, user, supporterA)).status, user.role).toBe(403);
      expect((await assign('does-not-exist', user, supporterA)).status, user.role).toBe(403);
    }
    expect((await assign(target.id, null, supporterA)).status).toBe(401);
    expect((await reload(target.id)).status).toBe('SUBMITTED');
  });

  it('없는 요청서는 404', async () => {
    expect((await assign('does-not-exist', admin, supporterA)).status).toBe(404);
  });
});

describe('POST /api/requests/:id/assign: 동시 처리', () => {
  it('관리자 배정과 지원자 접수가 동시에 일어나면 한 쪽만 반영되고 담당자는 한 명이다', async () => {
    for (let i = 0; i < 5; i += 1) {
      const target = await submitted();
      const [assigned, accepted] = await Promise.all([
        assign(target.id, admin, supporterA),
        call('post', `/requests/${target.id}/accept`, supporterB),
      ]);

      expect([assigned.status, accepted.status].sort()).toEqual([200, 409]);
      const saved = await reload(target.id);
      const log = await events(target.id);
      expect(log).toHaveLength(1);
      if (assigned.status === 200) {
        expect(saved.assigneeId).toBe(supporterA.id);
        expect(log[0].type).toBe('ASSIGN');
      } else {
        expect(saved.assigneeId).toBe(supporterB.id);
        expect(log[0].type).toBe('ACCEPT');
      }
    }
  });

  it('같은 요청서를 서로 다른 지원자에게 동시에 배정해도 한 번만 반영된다', async () => {
    const target = await submitted();
    const results = await Promise.all([
      assign(target.id, admin, supporterA),
      assign(target.id, admin, supporterB),
      assign(target.id, admin, supporterA),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect(await events(target.id)).toHaveLength(1);
    expect((await reload(target.id)).status).toBe('ACCEPTED');
  });
});
