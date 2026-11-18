// DB 테스트: 전용 테스트 DB에서만 실행된다. (npm run test:db)
// vitest 는 ESM 전용이라 테스트 파일만 import 문법을 쓴다. 소스(CommonJS)는 기본 import 후 구조 분해한다.
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
const review = (id, user, body) => auth(request(app).post(`/api/requests/${id}/first-review`), user).send(body);
const get = (path, user) => auth(request(app).get(path), user);

const approve = { decision: 'APPROVE' };
const reject = (reason = '증빙 자료가 부족합니다.') => ({ decision: 'REJECT', reason });

const inReview = (overrides = {}) =>
  createRequest({ requester, supportType, status: 'FIRST_REVIEW', assignee, ...overrides });
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

describe('POST /api/requests/:id/first-review: 승인', () => {
  it('작성자가 승인하면 최종 확인 대기가 되고 FIRST_APPROVE 이력이 남는다', async () => {
    const target = await inReview();
    await addWorkLog(target);
    const res = await review(target.id, requester, approve);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('FINAL_REVIEW');
    expect(res.body.canFirstReview).toBe(false);
    // 담당 지원자와 작업내역은 그대로여야 한다.
    expect(res.body.assignee.id).toBe(assignee.id);
    expect(res.body.workLogs).toHaveLength(1);

    expect((await reload(target.id)).status).toBe('FINAL_REVIEW');
    const log = await events(target.id);
    expect(log.map((e) => [e.type, e.actorId, e.reason])).toEqual([['FIRST_APPROVE', requester.id, null]]);
  });

  it('승인에 사유를 같이 보내도 이력에는 남지 않는다', async () => {
    const target = await inReview();
    await review(target.id, requester, { decision: 'APPROVE', reason: '무시되어야 함' });
    expect((await events(target.id))[0].reason).toBeNull();
  });

  it('관리자라도 본인이 작성한 요청서는 1차 확인할 수 있다', async () => {
    const target = await inReview({ requester: admin });
    const res = await review(target.id, admin, approve);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('FINAL_REVIEW');
  });
});

describe('POST /api/requests/:id/first-review: 반려', () => {
  it('사유와 함께 반려하면 재작업이 되고 이력에 사유가 남으며 담당 지원자·작업내역은 유지된다', async () => {
    const target = await inReview();
    await addWorkLog(target);
    const res = await review(target.id, requester, reject('  결과물 형식이 요청과 다릅니다.  '));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('REWORK');
    expect(res.body.assignee.id).toBe(assignee.id);
    expect(res.body.workLogs).toHaveLength(1);

    const saved = await reload(target.id);
    expect(saved).toMatchObject({ status: 'REWORK', assigneeId: assignee.id });
    const log = await events(target.id);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      type: 'FIRST_REJECT',
      actorId: requester.id,
      reason: '결과물 형식이 요청과 다릅니다.',
    });
  });

  it('여러 번 반려되어도 사유가 이력으로 모두 남는다', async () => {
    const target = await inReview();
    await review(target.id, requester, reject('첫 번째 사유'));
    // 재제출(T-11)은 아직 없으므로 상태를 직접 되돌려 두 번째 반려를 만든다.
    await prisma.request.update({ where: { id: target.id }, data: { status: 'FIRST_REVIEW' } });
    await review(target.id, requester, reject('두 번째 사유'));

    expect((await events(target.id)).map((e) => e.reason)).toEqual(['첫 번째 사유', '두 번째 사유']);
  });
});

describe('POST /api/requests/:id/first-review: 입력 검증(400)', () => {
  it.each([
    ['사유 없음', { decision: 'REJECT' }, 'reason'],
    ['사유가 빈 문자열', { decision: 'REJECT', reason: '' }, 'reason'],
    ['사유가 공백뿐', { decision: 'REJECT', reason: '    ' }, 'reason'],
    ['사유가 너무 김', { decision: 'REJECT', reason: 'a'.repeat(2001) }, 'reason'],
    ['결정 없음', {}, 'decision'],
    ['알 수 없는 결정', { decision: 'MAYBE' }, 'decision'],
  ])('%s', async (_name, body, field) => {
    const target = await inReview();
    const res = await review(target.id, requester, body);

    expect(res.status).toBe(400);
    expect(res.body.error.details).toHaveProperty(field);
    // 아무것도 바뀌지 않아야 한다.
    expect((await reload(target.id)).status).toBe('FIRST_REVIEW');
    expect(await events(target.id)).toHaveLength(0);
  });
});

describe('POST /api/requests/:id/first-review: 권한과 상태', () => {
  it('토큰이 없으면 401, 없는 요청서는 404', async () => {
    const target = await inReview();
    expect((await review(target.id, null, approve)).status).toBe(401);
    expect((await review('does-not-exist', requester, approve)).status).toBe(404);
  });

  it('작성자가 아닌 사람은 확인할 수 없다(403): 다른 요청자, 담당 지원자, 다른 지원자, 관리자', async () => {
    const target = await inReview();
    for (const user of [otherRequester, assignee, otherSupporter, admin]) {
      expect((await review(target.id, user, approve)).status, user.role).toBe(403);
      expect((await review(target.id, user, reject())).status, user.role).toBe(403);
    }
    expect((await reload(target.id)).status).toBe('FIRST_REVIEW');
    expect(await events(target.id)).toHaveLength(0);
  });

  it.each(['SUBMITTED', 'ACCEPTED', 'FINAL_REVIEW', 'REWORK', 'COMPLETED'])(
    '작성자라도 %s 상태에서는 확인할 수 없다(409)',
    async (status) => {
      const target = await inReview({ status });
      expect((await review(target.id, requester, approve)).status).toBe(409);
      expect((await review(target.id, requester, reject())).status).toBe(409);
      expect((await reload(target.id)).status).toBe(status);
      expect(await events(target.id)).toHaveLength(0);
    }
  );

  it('같은 승인이 동시에 여러 번 들어와도 한 번만 반영된다', async () => {
    const target = await inReview();
    const results = await Promise.all([
      review(target.id, requester, approve),
      review(target.id, requester, approve),
      review(target.id, requester, approve),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect(await events(target.id)).toHaveLength(1);
    expect((await reload(target.id)).status).toBe('FINAL_REVIEW');
  });

  it('승인과 반려가 동시에 들어오면 하나만 반영되고 결과가 일관된다', async () => {
    for (let i = 0; i < 5; i += 1) {
      const target = await inReview();
      const [a, r] = await Promise.all([
        review(target.id, requester, approve),
        review(target.id, requester, reject('동시 반려')),
      ]);

      expect([a.status, r.status].sort()).toEqual([200, 409]);
      const saved = await reload(target.id);
      const log = await events(target.id);
      expect(log).toHaveLength(1);
      if (a.status === 200) {
        expect(saved.status).toBe('FINAL_REVIEW');
        expect(log[0].type).toBe('FIRST_APPROVE');
      } else {
        expect(saved.status).toBe('REWORK');
        expect(log[0]).toMatchObject({ type: 'FIRST_REJECT', reason: '동시 반려' });
      }
    }
  });
});

describe('1차 확인 후 상세 응답', () => {
  it('확인 대기 중인 요청서는 작성자에게만 canFirstReview가 true이고 작업내역이 함께 내려온다', async () => {
    const target = await inReview();
    await addWorkLog(target);

    const asOwner = await get(`/api/requests/${target.id}`, requester);
    expect(asOwner.body).toMatchObject({ canFirstReview: true, status: 'FIRST_REVIEW' });
    expect(asOwner.body.workLogs.map((w) => [w.round, w.minutes, w.content])).toEqual([[1, 30, '작업함']]);

    const asAssignee = await get(`/api/requests/${target.id}`, assignee);
    expect(asAssignee.body.canFirstReview).toBe(false);
    const asAdmin = await get(`/api/requests/${target.id}`, admin);
    expect(asAdmin.body.canFirstReview).toBe(false);
  });

  it('목록 응답에도 canFirstReview가 들어 있다', async () => {
    const target = await inReview();
    const list = await get('/api/requests?status=FIRST_REVIEW&pageSize=100', requester);
    const item = list.body.items.find((i) => i.id === target.id);
    expect(item.canFirstReview).toBe(true);
  });
});
