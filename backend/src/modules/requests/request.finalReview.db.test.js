// DB 테스트: 전용 테스트 DB에서만 실행된다. (npm run test:db)
// vitest 는 ESM 전용이라 테스트 파일만 import 문법을 쓴다. 소스(CommonJS)는 기본 import 후 구조 분해한다.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../../app.js';
import factories from '../../test/factories.js';

const { prisma, createUser, createSupportType, createRequest, tokenFor, cleanup } = factories;

let requester;
let assignee;
let otherSupporter;
let admin;
let otherAdmin;
let supportType;

const auth = (req, user) => (user ? req.set('Authorization', `Bearer ${tokenFor(user)}`) : req);
const review = (id, user, body) => auth(request(app).post(`/api/requests/${id}/final-review`), user).send(body);
const get = (path, user) => auth(request(app).get(path), user);

const approve = { decision: 'APPROVE' };
const reject = (reason = '증빙 자료가 부족합니다.') => ({ decision: 'REJECT', reason });

const inFinal = (overrides = {}) =>
  createRequest({ requester, supportType, status: 'FINAL_REVIEW', assignee, ...overrides });
const events = (requestId) => prisma.requestEvent.findMany({ where: { requestId }, orderBy: { createdAt: 'asc' } });
const reload = (id) => prisma.request.findUnique({ where: { id } });
const addWorkLog = (target) =>
  prisma.workLog.create({
    data: { requestId: target.id, authorId: assignee.id, content: '작업함', minutes: 30, round: 1 },
  });

beforeAll(async () => {
  // 안전장치: 앱이 실제로 테스트 DB를 쓰고 있는지 한 번 더 확인한다.
  const [{ db }] = await prisma.$queryRaw`select current_database() as db`;
  expect(db.endsWith('_test')).toBe(true);

  [requester, assignee, otherSupporter, admin, otherAdmin] = await Promise.all([
    createUser('REQUESTER'),
    createUser('SUPPORTER'),
    createUser('SUPPORTER'),
    createUser('ADMIN'),
    createUser('ADMIN'),
  ]);
  supportType = await createSupportType();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('POST /api/requests/:id/final-review: 승인', () => {
  it('관리자가 승인하면 완료가 되고 완료 시각과 FINAL_APPROVE 이력이 남는다', async () => {
    const target = await inFinal();
    await addWorkLog(target);
    const before = Date.now();
    const res = await review(target.id, admin, approve);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('COMPLETED');
    expect(res.body.canFinalReview).toBe(false);
    expect(res.body.assignee.id).toBe(assignee.id);
    expect(res.body.workLogs).toHaveLength(1);
    expect(new Date(res.body.completedAt).getTime()).toBeGreaterThanOrEqual(before - 1000);

    const saved = await reload(target.id);
    expect(saved.status).toBe('COMPLETED');
    expect(saved.completedAt).not.toBeNull();
    expect((await events(target.id)).map((e) => [e.type, e.actorId, e.reason])).toEqual([
      ['FINAL_APPROVE', admin.id, null],
    ]);
  });

  it('승인에 사유를 같이 보내도 이력에는 남지 않는다', async () => {
    const target = await inFinal();
    await review(target.id, admin, { decision: 'APPROVE', reason: '무시되어야 함' });
    expect((await events(target.id))[0].reason).toBeNull();
  });
});

describe('POST /api/requests/:id/final-review: 반려', () => {
  it('사유와 함께 반려하면 재작업이 되고 이력에 사유가 남으며 완료 시각은 비어 있다', async () => {
    const target = await inFinal();
    await addWorkLog(target);
    const res = await review(target.id, admin, reject('  최종 점검에서 형식 오류가 발견되었습니다.  '));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('REWORK');
    expect(res.body.completedAt).toBeNull();
    expect(res.body.assignee.id).toBe(assignee.id);
    expect(res.body.workLogs).toHaveLength(1);

    const saved = await reload(target.id);
    expect(saved).toMatchObject({ status: 'REWORK', assigneeId: assignee.id, completedAt: null });
    const log = await events(target.id);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      type: 'FINAL_REJECT',
      actorId: admin.id,
      reason: '최종 점검에서 형식 오류가 발견되었습니다.',
    });
  });
});

describe('POST /api/requests/:id/final-review: 입력 검증(400)', () => {
  it.each([
    ['사유 없음', { decision: 'REJECT' }, 'reason'],
    ['사유가 공백뿐', { decision: 'REJECT', reason: '    ' }, 'reason'],
    ['사유가 너무 김', { decision: 'REJECT', reason: 'a'.repeat(2001) }, 'reason'],
    ['결정 없음', {}, 'decision'],
    ['알 수 없는 결정', { decision: 'MAYBE' }, 'decision'],
  ])('%s', async (_name, body, field) => {
    const target = await inFinal();
    const res = await review(target.id, admin, body);

    expect(res.status).toBe(400);
    expect(res.body.error.details).toHaveProperty(field);
    expect((await reload(target.id)).status).toBe('FINAL_REVIEW');
    expect(await events(target.id)).toHaveLength(0);
  });
});

describe('POST /api/requests/:id/final-review: 권한과 상태', () => {
  it('토큰이 없으면 401, 없는 요청서는 404', async () => {
    const target = await inFinal();
    expect((await review(target.id, null, approve)).status).toBe(401);
    expect((await review('does-not-exist', admin, approve)).status).toBe(404);
  });

  it('관리자가 아니면 확인할 수 없다(403): 작성자, 담당 지원자, 다른 지원자', async () => {
    const target = await inFinal();
    for (const user of [requester, assignee, otherSupporter]) {
      expect((await review(target.id, user, approve)).status, user.role).toBe(403);
      expect((await review(target.id, user, reject())).status, user.role).toBe(403);
    }
    expect((await reload(target.id)).status).toBe('FINAL_REVIEW');
    expect(await events(target.id)).toHaveLength(0);
  });

  it('관리자가 아니면 존재하지 않는 요청서에도 403이다(라우트의 관리자 제한이 요청서 조회보다 먼저 동작)', async () => {
    // 상태 전이 검사만 있으면 404가 나온다. 403이면 라우트 단계에서 이미 막았다는 뜻이다.
    for (const user of [requester, assignee, otherSupporter]) {
      expect((await review('does-not-exist', user, approve)).status, user.role).toBe(403);
    }
  });

  it('작성자 본인이 관리자이거나 서로 다른 관리자여도 최종 확인할 수 있다', async () => {
    const own = await inFinal({ requester: admin });
    expect((await review(own.id, admin, approve)).status).toBe(200);

    const others = await inFinal();
    expect((await review(others.id, otherAdmin, approve)).status).toBe(200);
  });

  it.each(['SUBMITTED', 'ACCEPTED', 'FIRST_REVIEW', 'REWORK', 'COMPLETED'])(
    '관리자라도 %s 상태에서는 최종 확인할 수 없다(409)',
    async (status) => {
      const target = await inFinal({ status });
      expect((await review(target.id, admin, approve)).status).toBe(409);
      expect((await review(target.id, admin, reject())).status).toBe(409);
      expect((await reload(target.id)).status).toBe(status);
      expect(await events(target.id)).toHaveLength(0);
    }
  );

  it('이미 완료된 요청서는 다시 승인·반려할 수 없고 완료 시각도 바뀌지 않는다', async () => {
    const target = await inFinal();
    await review(target.id, admin, approve);
    const completedAt = (await reload(target.id)).completedAt;

    expect((await review(target.id, admin, approve)).status).toBe(409);
    expect((await review(target.id, otherAdmin, reject())).status).toBe(409);
    expect((await reload(target.id)).completedAt).toEqual(completedAt);
    expect(await events(target.id)).toHaveLength(1);
  });

  it('두 관리자가 같은 요청서를 동시에 승인해도 한 번만 반영된다', async () => {
    const target = await inFinal();
    const results = await Promise.all([
      review(target.id, admin, approve),
      review(target.id, otherAdmin, approve),
      review(target.id, admin, approve),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect(await events(target.id)).toHaveLength(1);
    expect((await reload(target.id)).status).toBe('COMPLETED');
  });

  it('승인과 반려가 동시에 들어오면 하나만 반영되고 결과가 일관된다', async () => {
    for (let i = 0; i < 5; i += 1) {
      const target = await inFinal();
      const [a, r] = await Promise.all([
        review(target.id, admin, approve),
        review(target.id, otherAdmin, reject('동시 반려')),
      ]);

      expect([a.status, r.status].sort()).toEqual([200, 409]);
      const saved = await reload(target.id);
      const log = await events(target.id);
      expect(log).toHaveLength(1);
      if (a.status === 200) {
        expect(saved.status).toBe('COMPLETED');
        expect(saved.completedAt).not.toBeNull();
        expect(log[0].type).toBe('FINAL_APPROVE');
      } else {
        expect(saved.status).toBe('REWORK');
        expect(saved.completedAt).toBeNull();
        expect(log[0]).toMatchObject({ type: 'FINAL_REJECT', reason: '동시 반려' });
      }
    }
  });
});

describe('최종 확인 대기 요청서의 조회', () => {
  it('관리자에게만 canFinalReview가 true이고 작업내역이 함께 내려온다', async () => {
    const target = await inFinal();
    await addWorkLog(target);

    const asAdmin = await get(`/api/requests/${target.id}`, admin);
    expect(asAdmin.body).toMatchObject({ canFinalReview: true, status: 'FINAL_REVIEW' });
    expect(asAdmin.body.workLogs.map((w) => [w.round, w.minutes, w.content])).toEqual([[1, 30, '작업함']]);

    for (const viewer of [requester, assignee]) {
      expect((await get(`/api/requests/${target.id}`, viewer)).body.canFinalReview).toBe(false);
    }
  });

  it('관리자 목록에서 최종 확인 대기만 골라 볼 수 있다', async () => {
    const waiting = await inFinal();
    const other = await inFinal({ status: 'FIRST_REVIEW' });
    const list = await get('/api/requests?status=FINAL_REVIEW&pageSize=100', admin);

    const ids = list.body.items.map((i) => i.id);
    expect(ids).toContain(waiting.id);
    expect(ids).not.toContain(other.id);
    expect(list.body.items.find((i) => i.id === waiting.id).canFinalReview).toBe(true);
  });
});
