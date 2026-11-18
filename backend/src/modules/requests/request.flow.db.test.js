// 통합 테스트(M1 완료 기준): 요청자·지원자·관리자 계정 3개로 요청서 한 건이 제출부터 완료까지 통과한다.
// DB 테스트: 전용 테스트 DB에서만 실행된다. (npm run test:db)
// vitest 는 ESM 전용이라 테스트 파일만 import 문법을 쓴다. 소스(CommonJS)는 기본 import 후 구조 분해한다.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../../app.js';
import factories from '../../test/factories.js';

const { prisma, createUser, createSupportType, tokenFor, cleanup } = factories;

let requester;
let supporter;
let admin;
let supportType;

const call = (method, path, user, body) => {
  const req = request(app)[method](`/api${path}`).set('Authorization', `Bearer ${tokenFor(user)}`);
  return body ? req.send(body) : req;
};

const newRequestBody = () => ({
  supportTypeId: supportType.id,
  title: '통합 테스트 요청서',
  content: '월간 보고서를 자동으로 만들고 싶습니다.',
  department: '기획처',
  contactName: '홍길동',
  contactPhone: '010-1234-5678',
  interviewAt: '2026-11-20T10:00:00.000Z',
  desiredDate: '2026-12-01',
  urgency: 'HIGH',
});

const events = (requestId) => prisma.requestEvent.findMany({ where: { requestId }, orderBy: { createdAt: 'asc' } });

beforeAll(async () => {
  // 안전장치: 앱이 실제로 테스트 DB를 쓰고 있는지 한 번 더 확인한다.
  const [{ db }] = await prisma.$queryRaw`select current_database() as db`;
  expect(db.endsWith('_test')).toBe(true);

  [requester, supporter, admin] = await Promise.all([
    createUser('REQUESTER'),
    createUser('SUPPORTER'),
    createUser('ADMIN'),
  ]);
  supportType = await createSupportType();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('요청서 한 건의 전체 흐름', () => {
  it('제출 → 접수 → 작업내역 → 1차 승인 → 최종 승인으로 완료된다', async () => {
    // 1) 요청자가 제출한다.
    const created = await call('post', '/requests', requester, newRequestBody());
    expect(created.status).toBe(201);
    const id = created.body.id;
    expect(created.body.status).toBe('SUBMITTED');

    // 2) 지원자가 접수 목록에서 찾아 접수한다.
    const available = await call('get', '/requests?scope=available&pageSize=100', supporter);
    expect(available.body.items.some((i) => i.id === id && i.canAccept)).toBe(true);
    const accepted = await call('post', `/requests/${id}/accept`, supporter);
    expect(accepted.status).toBe(200);
    expect(accepted.body.status).toBe('ACCEPTED');

    // 3) 지원자가 작업내역을 제출한다.
    const worked = await call('post', `/requests/${id}/work-logs`, supporter, { content: '자동화 완료', minutes: 120 });
    expect(worked.status).toBe(201);
    expect(worked.body.status).toBe('FIRST_REVIEW');

    // 4) 요청자가 1차 확인(승인)한다.
    const firstView = await call('get', `/requests/${id}`, requester);
    expect(firstView.body).toMatchObject({ canFirstReview: true, canFinalReview: false });
    expect(firstView.body.workLogs.map((w) => w.content)).toEqual(['자동화 완료']);
    const first = await call('post', `/requests/${id}/first-review`, requester, { decision: 'APPROVE' });
    expect(first.status).toBe(200);
    expect(first.body.status).toBe('FINAL_REVIEW');

    // 5) 관리자가 최종 확인(승인)한다.
    const waiting = await call('get', '/requests?status=FINAL_REVIEW&pageSize=100', admin);
    expect(waiting.body.items.some((i) => i.id === id && i.canFinalReview)).toBe(true);
    const final = await call('post', `/requests/${id}/final-review`, admin, { decision: 'APPROVE' });
    expect(final.status).toBe(200);
    expect(final.body.status).toBe('COMPLETED');
    expect(final.body.completedAt).not.toBeNull();

    // 완료된 요청서: 모든 단계 이력이 순서대로 남고 더 이상 할 수 있는 동작이 없다.
    expect((await events(id)).map((e) => [e.type, e.actorId])).toEqual([
      ['SUBMIT', requester.id],
      ['ACCEPT', supporter.id],
      ['WORK_SUBMIT', supporter.id],
      ['FIRST_APPROVE', requester.id],
      ['FINAL_APPROVE', admin.id],
    ]);
    for (const viewer of [requester, supporter, admin]) {
      const detail = await call('get', `/requests/${id}`, viewer);
      expect(detail.body.status).toBe('COMPLETED');
      expect(detail.body).toMatchObject({
        canEdit: false,
        canAccept: false,
        canCancelAccept: false,
        canSubmitWork: false,
        canFirstReview: false,
        canFinalReview: false,
      });
    }
    expect((await call('post', `/requests/${id}/final-review`, admin, { decision: 'APPROVE' })).status).toBe(409);
  });

  it('단계를 건너뛸 수 없다: 접수 전 작업내역·확인, 1차 확인 전 최종 확인은 모두 거부된다', async () => {
    const created = await call('post', '/requests', requester, newRequestBody());
    const id = created.body.id;

    expect((await call('post', `/requests/${id}/work-logs`, supporter, { content: 'x', minutes: 1 })).status).toBe(403);
    expect((await call('post', `/requests/${id}/first-review`, requester, { decision: 'APPROVE' })).status).toBe(409);
    expect((await call('post', `/requests/${id}/final-review`, admin, { decision: 'APPROVE' })).status).toBe(409);

    await call('post', `/requests/${id}/accept`, supporter);
    expect((await call('post', `/requests/${id}/first-review`, requester, { decision: 'APPROVE' })).status).toBe(409);
    expect((await call('post', `/requests/${id}/final-review`, admin, { decision: 'APPROVE' })).status).toBe(409);

    await call('post', `/requests/${id}/work-logs`, supporter, { content: '작업', minutes: 10 });
    // 1차 확인 없이 관리자가 최종 확인을 할 수는 없다.
    expect((await call('post', `/requests/${id}/final-review`, admin, { decision: 'APPROVE' })).status).toBe(409);
    expect((await prisma.request.findUnique({ where: { id } })).status).toBe('FIRST_REVIEW');
  });

  it('최종 반려되면 재작업이 되고 완료되지 않은 채 사유가 이력에 남는다', async () => {
    const created = await call('post', '/requests', requester, newRequestBody());
    const id = created.body.id;
    await call('post', `/requests/${id}/accept`, supporter);
    await call('post', `/requests/${id}/work-logs`, supporter, { content: '작업', minutes: 10 });
    await call('post', `/requests/${id}/first-review`, requester, { decision: 'APPROVE' });

    const rejected = await call('post', `/requests/${id}/final-review`, admin, {
      decision: 'REJECT',
      reason: '최종 검토에서 보완이 필요합니다.',
    });
    expect(rejected.status).toBe(200);
    expect(rejected.body).toMatchObject({ status: 'REWORK', completedAt: null });

    const log = await events(id);
    expect(log.at(-1)).toMatchObject({
      type: 'FINAL_REJECT',
      actorId: admin.id,
      reason: '최종 검토에서 보완이 필요합니다.',
    });
  });
});
