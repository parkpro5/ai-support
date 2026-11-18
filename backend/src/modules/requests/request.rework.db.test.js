// DB 테스트: 전용 테스트 DB에서만 실행된다. (npm run test:db)
// 재작업(반려 후 재제출)과 처리 이력 타임라인을 검증한다.
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
let supportType;

const call = (method, path, user, body) => {
  const req = request(app)[method](`/api${path}`);
  if (user) req.set('Authorization', `Bearer ${tokenFor(user)}`);
  return body ? req.send(body) : req;
};
const resubmit = (id, user, body = { content: '수정한 작업 내용', minutes: 20 }) =>
  call('post', `/requests/${id}/work-logs`, user, body);

const rework = (overrides = {}) =>
  createRequest({ requester, supportType, status: 'REWORK', assignee, ...overrides });
const events = (requestId) =>
  prisma.requestEvent.findMany({ where: { requestId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
const workLogs = (requestId) => prisma.workLog.findMany({ where: { requestId }, orderBy: { round: 'asc' } });
const reload = (id) => prisma.request.findUnique({ where: { id } });
const addLog = (target, round, content = `${round}회차 작업`) =>
  prisma.workLog.create({
    data: { requestId: target.id, authorId: assignee.id, content, minutes: round * 10, round },
  });

beforeAll(async () => {
  // 안전장치: 앱이 실제로 테스트 DB를 쓰고 있는지 한 번 더 확인한다.
  const [{ db }] = await prisma.$queryRaw`select current_database() as db`;
  expect(db.endsWith('_test')).toBe(true);

  [requester, assignee, otherSupporter, admin] = await Promise.all([
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

describe('재작업 후 재제출', () => {
  it('담당 지원자가 재제출하면 1차 확인 대기가 되고 다음 회차 작업내역과 RESUBMIT 이력이 남는다', async () => {
    const target = await rework();
    await addLog(target, 1, '처음 작업');

    const res = await resubmit(target.id, assignee, { content: '반려 사유를 반영해 고쳤습니다.', minutes: 45 });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('FIRST_REVIEW');
    // 이전 회차는 그대로 남고 새 회차가 추가된다.
    expect(res.body.workLogs.map((w) => [w.round, w.content, w.minutes])).toEqual([
      [1, '처음 작업', 10],
      [2, '반려 사유를 반영해 고쳤습니다.', 45],
    ]);
    expect(res.body).toMatchObject({ canSubmitWork: false });

    expect((await reload(target.id)).status).toBe('FIRST_REVIEW');
    expect((await workLogs(target.id)).map((w) => w.round)).toEqual([1, 2]);
    expect((await events(target.id)).map((e) => [e.type, e.actorId])).toEqual([['RESUBMIT', assignee.id]]);
  });

  it('재제출하면 요청자가 다시 1차 확인을 할 수 있다', async () => {
    const target = await rework();
    await addLog(target, 1);
    await resubmit(target.id, assignee);

    const detail = await call('get', `/requests/${target.id}`, requester);
    expect(detail.body).toMatchObject({ status: 'FIRST_REVIEW', canFirstReview: true });
  });

  it('재작업 상태의 담당 지원자에게는 제출 버튼 플래그가 켜져 있다', async () => {
    const target = await rework();
    const detail = await call('get', `/requests/${target.id}`, assignee);
    expect(detail.body).toMatchObject({ canSubmitWork: true, canCancelAccept: false });
  });

  it('입력 검증은 첫 제출과 같다(400)이고 아무것도 바뀌지 않는다', async () => {
    const target = await rework();
    await addLog(target, 1);
    const res = await resubmit(target.id, assignee, { content: '   ', minutes: -1 });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toHaveProperty('content');
    expect(res.body.error.details).toHaveProperty('minutes');
    expect((await reload(target.id)).status).toBe('REWORK');
    expect(await workLogs(target.id)).toHaveLength(1);
    expect(await events(target.id)).toHaveLength(0);
  });

  it('담당이 아닌 사람은 재제출할 수 없다(403): 다른 지원자, 요청자, 관리자', async () => {
    const target = await rework();
    await addLog(target, 1);
    for (const user of [otherSupporter, requester, admin]) {
      expect((await resubmit(target.id, user)).status, user.role).toBe(403);
    }
    expect((await reload(target.id)).status).toBe('REWORK');
    expect(await workLogs(target.id)).toHaveLength(1);
  });

  it('재작업이 아니면 재제출처럼 보내도 거부된다(409): 이미 제출한 상태', async () => {
    for (const status of ['FIRST_REVIEW', 'FINAL_REVIEW', 'COMPLETED']) {
      const target = await rework({ status });
      await addLog(target, 1);
      expect((await resubmit(target.id, assignee)).status, status).toBe(409);
      expect(await workLogs(target.id)).toHaveLength(1);
    }
  });

  it('재작업 상태에서는 접수를 취소할 수 없다(409)', async () => {
    const target = await rework();
    expect((await call('post', `/requests/${target.id}/cancel-accept`, assignee)).status).toBe(409);
    expect((await reload(target.id)).assigneeId).toBe(assignee.id);
  });

  it('같은 재제출이 동시에 여러 번 들어와도 한 번만 반영된다', async () => {
    const target = await rework();
    await addLog(target, 1);
    const results = await Promise.all([resubmit(target.id, assignee), resubmit(target.id, assignee), resubmit(target.id, assignee)]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect((await workLogs(target.id)).map((w) => w.round)).toEqual([1, 2]);
    expect(await events(target.id)).toHaveLength(1);
    expect((await reload(target.id)).status).toBe('FIRST_REVIEW');
  });

  it('회차는 이전 회차 번호가 건너뛰어 있어도 마지막 회차 + 1이다', async () => {
    const target = await rework();
    await addLog(target, 1);
    await addLog(target, 4);
    const res = await resubmit(target.id, assignee);

    expect(res.status).toBe(201);
    expect(res.body.workLogs.map((w) => w.round)).toEqual([1, 4, 5]);
  });
});

describe('반려를 두 번 반복하는 전체 흐름(처리 이력 타임라인)', () => {
  it('1차 반려 → 재제출 → 1차 승인 → 최종 반려 → 재제출 → 1차 승인 → 최종 승인으로 완료되고, 모든 사유와 회차가 조회된다', async () => {
    const created = await call('post', '/requests', requester, {
      supportTypeId: supportType.id,
      title: '반려 반복 요청서',
      content: '내용',
      department: '기획처',
      contactName: '홍길동',
      contactPhone: '010-1234-5678',
      interviewAt: '2026-11-20T10:00:00.000Z',
      desiredDate: '2026-12-01',
    });
    const id = created.body.id;

    const step = async (name, promise, expectedStatus) => {
      const res = await promise;
      expect(res.status, `${name}: ${JSON.stringify(res.body?.error ?? '')}`).toBeLessThan(300);
      expect(res.body.status, name).toBe(expectedStatus);
    };

    await step('접수', call('post', `/requests/${id}/accept`, assignee), 'ACCEPTED');
    await step('1회차 제출', resubmit(id, assignee, { content: '1회차 내용', minutes: 10 }), 'FIRST_REVIEW');
    await step('1차 반려', call('post', `/requests/${id}/first-review`, requester, { decision: 'REJECT', reason: '첫 번째 반려 사유' }), 'REWORK');
    await step('2회차 제출', resubmit(id, assignee, { content: '2회차 내용', minutes: 20 }), 'FIRST_REVIEW');
    await step('1차 승인', call('post', `/requests/${id}/first-review`, requester, { decision: 'APPROVE' }), 'FINAL_REVIEW');
    await step('최종 반려', call('post', `/requests/${id}/final-review`, admin, { decision: 'REJECT', reason: '두 번째 반려 사유' }), 'REWORK');
    await step('3회차 제출', resubmit(id, assignee, { content: '3회차 내용', minutes: 30 }), 'FIRST_REVIEW');
    await step('1차 승인(재)', call('post', `/requests/${id}/first-review`, requester, { decision: 'APPROVE' }), 'FINAL_REVIEW');
    await step('최종 승인', call('post', `/requests/${id}/final-review`, admin, { decision: 'APPROVE' }), 'COMPLETED');

    // 작성자, 담당 지원자, 관리자 모두 같은 이력을 본다.
    for (const viewer of [requester, assignee, admin]) {
      const detail = await call('get', `/requests/${id}`, viewer);
      expect(detail.status).toBe(200);

      // 모든 회차의 작업내역
      expect(detail.body.workLogs.map((w) => [w.round, w.content, w.minutes])).toEqual([
        [1, '1회차 내용', 10],
        [2, '2회차 내용', 20],
        [3, '3회차 내용', 30],
      ]);

      // 시간순 타임라인과 반려 사유, 제출 회차
      expect(detail.body.events.map((e) => [e.type, e.actor.id, e.reason, e.round ?? null])).toEqual([
        ['SUBMIT', requester.id, null, null],
        ['ACCEPT', assignee.id, null, null],
        ['WORK_SUBMIT', assignee.id, null, 1],
        ['FIRST_REJECT', requester.id, '첫 번째 반려 사유', null],
        ['RESUBMIT', assignee.id, null, 2],
        ['FIRST_APPROVE', requester.id, null, null],
        ['FINAL_REJECT', admin.id, '두 번째 반려 사유', null],
        ['RESUBMIT', assignee.id, null, 3],
        ['FIRST_APPROVE', requester.id, null, null],
        ['FINAL_APPROVE', admin.id, null, null],
      ]);
      expect(detail.body.status).toBe('COMPLETED');
    }
  });

  it('이력은 DB에도 시간순으로 모두 남는다', async () => {
    const target = await rework();
    await addLog(target, 1);
    await call('post', `/requests/${target.id}/work-logs`, assignee, { content: '다시', minutes: 1 });
    await call('post', `/requests/${target.id}/first-review`, requester, { decision: 'REJECT', reason: '또 반려' });
    await call('post', `/requests/${target.id}/work-logs`, assignee, { content: '또 다시', minutes: 1 });

    const rows = await events(target.id);
    expect(rows.map((e) => [e.type, e.reason])).toEqual([
      ['RESUBMIT', null],
      ['FIRST_REJECT', '또 반려'],
      ['RESUBMIT', null],
    ]);
    expect((await workLogs(target.id)).map((w) => w.round)).toEqual([1, 2, 3]);
  });
});

describe('이력 공개 범위', () => {
  it('접수 가능 목록을 둘러보는 다른 지원자에게는 이력과 작업내역이 비어 있다', async () => {
    const target = await createRequest({ requester, supportType });
    await call('post', `/requests/${target.id}/accept`, assignee);
    await call('post', `/requests/${target.id}/cancel-accept`, assignee);

    // 접수했다가 취소한 이력이 있는 제출됨 요청서. 요청자·관리자에게는 이력이 보이고, 다른 지원자에게는 안 보인다.
    const asOther = await call('get', `/requests/${target.id}`, otherSupporter);
    expect(asOther.status).toBe(200);
    expect(asOther.body.events).toEqual([]);
    expect(asOther.body.workLogs).toEqual([]);
    expect(asOther.body.contactPhone).toBeNull();

    const asOwner = await call('get', `/requests/${target.id}`, requester);
    expect(asOwner.body.events.map((e) => e.type)).toEqual(['ACCEPT', 'CANCEL_ACCEPT']);
    const asAdmin = await call('get', `/requests/${target.id}`, admin);
    expect(asAdmin.body.events.map((e) => e.type)).toEqual(['ACCEPT', 'CANCEL_ACCEPT']);
  });

  it('재작업 중인 요청서는 관련 없는 지원자가 아예 볼 수 없다(404)', async () => {
    const target = await rework();
    await addLog(target, 1);
    expect((await call('get', `/requests/${target.id}`, otherSupporter)).status).toBe(404);
  });

  it('이력에는 행위자의 이름만 나오고 이메일 등은 나오지 않는다', async () => {
    const target = await rework();
    await resubmit(target.id, assignee);
    const detail = await call('get', `/requests/${target.id}`, requester);
    const actor = detail.body.events[0].actor;
    expect(Object.keys(actor).sort()).toEqual(['id', 'name']);
  });
});
