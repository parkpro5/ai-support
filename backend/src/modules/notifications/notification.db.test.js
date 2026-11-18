// DB 테스트: 전용 테스트 DB에서만 실행된다. (npm run test:db)
// 실제 푸시 서버에는 보내지 않는다. push.service의 전송기를 가짜로 바꿔 "누구의 어느 기기로 무엇을 보냈는지"를 기록한다.
// vitest 는 ESM 전용이라 테스트 파일만 import 문법을 쓴다. 소스(CommonJS)는 기본 import 후 구조 분해한다.
import crypto from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import app from '../../app.js';
import factories from '../../test/factories.js';
import pushService from '../push/push.service.js';
import notificationService from './notification.service.js';

const { prisma, createUser, createSupportType, createRequest, tokenFor, cleanup } = factories;
const { notify, NOTIFY_WAIT_MS } = notificationService;

let requester;
let supporterA;
let supporterB;
let admin;
let otherAdmin;
let supportType;

/** 가짜 전송기가 받은 전송 기록. */
let sent = [];
/** endpoint별로 실패를 흉내낼 때 쓴다: { [endpoint]: Error }. 없으면 성공. */
let failures = {};

const call = (method, path, user, body) => {
  const req = request(app)[method](`/api${path}`);
  if (user) req.set('Authorization', `Bearer ${tokenFor(user)}`);
  return body ? req.send(body) : req;
};

const newEndpoint = (label) => `https://push.example.test/${label}-${crypto.randomBytes(4).toString('hex')}`;
const keys = { p256dh: 'test-p256dh', auth: 'test-auth' };
/** API로 구독을 등록한다(실제 화면이 하는 것과 같다). */
async function subscribe(user, label) {
  const endpoint = newEndpoint(label);
  const res = await call('post', '/push/subscribe', user, { endpoint, keys });
  expect(res.status).toBe(201);
  return endpoint;
}
const endpointsSent = () => sent.map((s) => s.endpoint).sort();
const subscriptionExists = async (endpoint) => (await prisma.pushSubscription.count({ where: { endpoint } })) === 1;

const newRequest = (overrides = {}) => createRequest({ requester, supportType, ...overrides });

// 기기 구독 목록(테스트마다 새로 등록한다)
let dev;

beforeAll(async () => {
  // 안전장치: 앱이 실제로 테스트 DB를 쓰고 있는지 한 번 더 확인한다.
  const [{ db }] = await prisma.$queryRaw`select current_database() as db`;
  expect(db.endsWith('_test')).toBe(true);

  [requester, supporterA, supporterB, admin, otherAdmin] = await Promise.all([
    createUser('REQUESTER'),
    createUser('SUPPORTER'),
    createUser('SUPPORTER'),
    createUser('ADMIN'),
    createUser('ADMIN'),
  ]);
  supportType = await createSupportType();
});

beforeEach(async () => {
  sent = [];
  failures = {};
  pushService.setTransport(async (subscription, body) => {
    if (failures[subscription.endpoint]) throw failures[subscription.endpoint];
    sent.push({ endpoint: subscription.endpoint, payload: JSON.parse(body) });
  });

  // 모든 역할의 기기를 구독시켜 두고, 각 테스트가 "누구에게만 갔는가"를 확인한다.
  await prisma.pushSubscription.deleteMany({
    where: { userId: { in: [requester.id, supporterA.id, supporterB.id, admin.id, otherAdmin.id] } },
  });
  dev = {
    requester: await subscribe(requester, 'requester'),
    supporterA1: await subscribe(supporterA, 'supA-phone'),
    supporterA2: await subscribe(supporterA, 'supA-pc'),
    supporterB: await subscribe(supporterB, 'supB'),
    admin: await subscribe(admin, 'admin'),
    otherAdmin: await subscribe(otherAdmin, 'otherAdmin'),
  };
});

afterEach(() => {
  pushService.resetTransport();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('구독 등록·해제 API', () => {
  it('구독을 등록하면 DB에 저장되고 해제하면 사라진다', async () => {
    const endpoint = await subscribe(requester, 'extra');
    expect(await subscriptionExists(endpoint)).toBe(true);

    const res = await call('post', '/push/unsubscribe', requester, { endpoint });
    expect(res.status).toBe(200);
    expect(await subscriptionExists(endpoint)).toBe(false);
  });

  it('잘못된 구독 정보는 400, 로그인하지 않으면 401', async () => {
    expect((await call('post', '/push/subscribe', requester, { endpoint: 'x' })).status).toBe(400);
    expect((await call('post', '/push/subscribe', requester, { endpoint: 'x', keys: { p256dh: 'p' } })).status).toBe(400);
    expect((await call('post', '/push/subscribe', null, { endpoint: 'x', keys: { p256dh: 'p', auth: 'a' } })).status).toBe(401);
  });

  it('다른 사용자의 구독은 해제할 수 없다', async () => {
    await call('post', '/push/unsubscribe', supporterB, { endpoint: dev.requester });
    expect(await subscriptionExists(dev.requester)).toBe(true);
  });

  it('같은 기기를 다른 사용자가 다시 구독하면 마지막 사용자의 것이 된다', async () => {
    const shared = newEndpoint('shared');
    await call('post', '/push/subscribe', requester, { endpoint: shared, keys });
    await call('post', '/push/subscribe', supporterB, { endpoint: shared, keys });

    const row = await prisma.pushSubscription.findUnique({ where: { endpoint: shared } });
    expect(row.userId).toBe(supporterB.id);

    // 요청자에게 가는 알림이 그 기기로 가지 않아야 한다.
    const target = await newRequest({ status: 'ACCEPTED', assignee: supporterA });
    await call('post', `/requests/${target.id}/work-logs`, supporterA, { content: '작업', minutes: 1 });
    expect(endpointsSent()).toEqual([dev.requester]);
  });
});

describe('알림 대상 (FR-9)', () => {
  it('요청서를 제출하면 구독한 모든 지원자의 모든 기기로만 간다', async () => {
    const res = await call('post', '/requests', requester, {
      supportTypeId: supportType.id,
      title: '새 요청서 제목',
      content: '내용',
      department: '부서',
      contactName: '이름',
      contactPhone: '010-1234-5678',
      interviewAt: '2026-11-20T10:00:00.000Z',
      desiredDate: '2026-12-01',
    });

    expect(res.status).toBe(201);
    expect(endpointsSent()).toEqual([dev.supporterA1, dev.supporterA2, dev.supporterB].sort());
    expect(sent[0].payload).toEqual({ title: '새 지원요청이 올라왔습니다', body: '새 요청서 제목', url: '/requests' });
  });

  it('구독을 해제한 기기에는 가지 않는다', async () => {
    await call('post', '/push/unsubscribe', supporterA, { endpoint: dev.supporterA2 });
    await call('post', '/push/unsubscribe', supporterB, { endpoint: dev.supporterB });

    await call('post', '/requests', requester, {
      supportTypeId: supportType.id,
      title: '제목',
      content: '내용',
      department: '부서',
      contactName: '이름',
      contactPhone: '010-1234-5678',
      interviewAt: '2026-11-20T10:00:00.000Z',
      desiredDate: '2026-12-01',
    });

    expect(endpointsSent()).toEqual([dev.supporterA1]);
  });

  it('구독한 기기가 하나도 없어도 본 처리는 정상이다', async () => {
    await prisma.pushSubscription.deleteMany({});
    const res = await call('post', '/requests', requester, {
      supportTypeId: supportType.id,
      title: '제목',
      content: '내용',
      department: '부서',
      contactName: '이름',
      contactPhone: '010-1234-5678',
      interviewAt: '2026-11-20T10:00:00.000Z',
      desiredDate: '2026-12-01',
    });
    expect(res.status).toBe(201);
    expect(sent).toEqual([]);
  });

  it('작업내역을 제출하면 요청서 작성자에게만 간다', async () => {
    const target = await newRequest({ status: 'ACCEPTED', assignee: supporterA });
    const res = await call('post', `/requests/${target.id}/work-logs`, supporterA, { content: '작업', minutes: 5 });

    expect(res.status).toBe(201);
    expect(endpointsSent()).toEqual([dev.requester]);
    expect(sent[0].payload).toMatchObject({ url: `/requests/${target.id}/review`, body: '테스트 요청서' });
  });

  it('재작업 후 재제출해도 작성자에게 간다', async () => {
    const target = await newRequest({ status: 'REWORK', assignee: supporterA });
    await call('post', `/requests/${target.id}/work-logs`, supporterA, { content: '다시', minutes: 5 });
    expect(endpointsSent()).toEqual([dev.requester]);
  });

  it('1차 승인하면 모든 관리자에게 가고 작성자 본인에게는 가지 않는다', async () => {
    const target = await newRequest({ status: 'FIRST_REVIEW', assignee: supporterA });
    const res = await call('post', `/requests/${target.id}/first-review`, requester, { decision: 'APPROVE' });

    expect(res.status).toBe(200);
    expect(endpointsSent()).toEqual([dev.admin, dev.otherAdmin].sort());
    expect(sent[0].payload.url).toBe(`/requests/${target.id}/final-review`);
  });

  it('1차 반려하면 담당 지원자의 모든 기기로만 간다', async () => {
    const target = await newRequest({ status: 'FIRST_REVIEW', assignee: supporterA });
    await call('post', `/requests/${target.id}/first-review`, requester, { decision: 'REJECT', reason: '보완 필요' });

    expect(endpointsSent()).toEqual([dev.supporterA1, dev.supporterA2].sort());
    expect(sent[0].payload).toMatchObject({ url: `/requests/${target.id}/work` });
    expect(sent[0].payload.title).toContain('반려');
  });

  it('최종 반려하면 담당 지원자에게 간다', async () => {
    const target = await newRequest({ status: 'FINAL_REVIEW', assignee: supporterA });
    await call('post', `/requests/${target.id}/final-review`, admin, { decision: 'REJECT', reason: '보완 필요' });
    expect(endpointsSent()).toEqual([dev.supporterA1, dev.supporterA2].sort());
  });

  it('최종 승인(완료)하면 작성자와 담당 지원자에게 가고 처리한 관리자에게는 가지 않는다', async () => {
    const target = await newRequest({ status: 'FINAL_REVIEW', assignee: supporterA });
    await call('post', `/requests/${target.id}/final-review`, admin, { decision: 'APPROVE' });

    expect(endpointsSent()).toEqual([dev.requester, dev.supporterA1, dev.supporterA2].sort());
    expect(sent[0].payload).toMatchObject({ title: '요청서가 완료되었습니다', url: `/requests/${target.id}` });
  });

  it('관리자가 배정하면 배정받은 지원자에게만 가고 배정한 관리자에게는 가지 않는다', async () => {
    const target = await newRequest();
    const res = await call('post', `/requests/${target.id}/assign`, admin, { supporterId: supporterB.id });

    expect(res.status).toBe(200);
    expect(endpointsSent()).toEqual([dev.supporterB]);
    expect(sent[0].payload.url).toBe(`/requests/${target.id}/work`);
  });

  it('접수와 접수 취소는 알리지 않는다', async () => {
    const target = await newRequest();
    await call('post', `/requests/${target.id}/accept`, supporterA);
    await call('post', `/requests/${target.id}/cancel-accept`, supporterA);
    expect(sent).toEqual([]);
  });

  it('관리자가 직접 작성한 요청서를 1차 승인하면 본인 기기는 빼고 다른 관리자에게만 간다', async () => {
    const target = await newRequest({ requester: admin, status: 'FIRST_REVIEW', assignee: supporterA });
    await call('post', `/requests/${target.id}/first-review`, admin, { decision: 'APPROVE' });
    expect(endpointsSent()).toEqual([dev.otherAdmin]);
  });

  it('반려·승인 같은 검증 실패(400, 403, 409)에는 알림이 가지 않는다', async () => {
    const target = await newRequest({ status: 'FIRST_REVIEW', assignee: supporterA });
    await call('post', `/requests/${target.id}/first-review`, requester, { decision: 'REJECT' }); // 사유 없음 400
    await call('post', `/requests/${target.id}/first-review`, supporterB, { decision: 'APPROVE' }); // 권한 없음 403
    const done = await newRequest({ status: 'COMPLETED', assignee: supporterA });
    await call('post', `/requests/${done.id}/final-review`, admin, { decision: 'APPROVE' }); // 상태 409
    expect(sent).toEqual([]);
  });

  it('같은 승인이 동시에 여러 번 들어와도 알림은 한 번만 간다', async () => {
    const target = await newRequest({ status: 'FIRST_REVIEW', assignee: supporterA });
    await Promise.all([1, 2, 3].map(() => call('post', `/requests/${target.id}/first-review`, requester, { decision: 'APPROVE' })));
    expect(endpointsSent()).toEqual([dev.admin, dev.otherAdmin].sort());
  });
});

describe('알림 실패가 본 처리에 영향을 주지 않는다', () => {
  const gone = (statusCode) => Object.assign(new Error(`push service responded ${statusCode}`), { statusCode });

  it.each([404, 410])('푸시 서버가 %s(만료)로 답하면 그 구독만 삭제하고 나머지 기기에는 보낸다', async (statusCode) => {
    failures[dev.supporterA1] = gone(statusCode);
    const target = await newRequest({ status: 'FIRST_REVIEW', assignee: supporterA });

    const res = await call('post', `/requests/${target.id}/first-review`, requester, { decision: 'REJECT', reason: '보완' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('REWORK');
    expect(await subscriptionExists(dev.supporterA1)).toBe(false); // 만료된 구독은 정리된다
    expect(await subscriptionExists(dev.supporterA2)).toBe(true);
    expect(endpointsSent()).toEqual([dev.supporterA2]); // 같은 사용자의 다른 기기는 받았다
  });

  it('만료 외의 실패(서버 오류, 네트워크)는 구독을 지우지 않고 본 처리는 성공한다', async () => {
    failures[dev.supporterA1] = gone(500);
    failures[dev.supporterA2] = new Error('socket hang up');
    const target = await newRequest({ status: 'FIRST_REVIEW', assignee: supporterA });

    const res = await call('post', `/requests/${target.id}/first-review`, requester, { decision: 'REJECT', reason: '보완' });

    expect(res.status).toBe(200);
    expect((await prisma.request.findUnique({ where: { id: target.id } })).status).toBe('REWORK');
    expect(await subscriptionExists(dev.supporterA1)).toBe(true);
    expect(await subscriptionExists(dev.supporterA2)).toBe(true);
  });

  it('전송기가 동기적으로 예외를 던져도 본 처리는 성공한다', async () => {
    pushService.setTransport(() => {
      throw new Error('boom');
    });
    const target = await newRequest({ status: 'ACCEPTED', assignee: supporterA });
    const res = await call('post', `/requests/${target.id}/work-logs`, supporterA, { content: '작업', minutes: 1 });

    expect(res.status).toBe(201);
    expect((await prisma.request.findUnique({ where: { id: target.id } })).status).toBe('FIRST_REVIEW');
    // 이력도 정상적으로 남아 있다.
    expect(await prisma.requestEvent.count({ where: { requestId: target.id, type: 'WORK_SUBMIT' } })).toBe(1);
  });

  it('notify 자체는 어떤 입력에도 예외를 던지지 않는다', async () => {
    await expect(notify('SUBMIT', null, 'x')).resolves.toBeUndefined();
    await expect(notify('FIRST_REJECT', { id: 'x' }, undefined)).resolves.toBeUndefined();
    await expect(notify('NOPE', {}, 'x')).resolves.toBeUndefined();
  });

  it(
    '푸시 서버가 응답하지 않아도 응답은 제한 시간 안에 돌아온다',
    async () => {
      pushService.setTransport(() => new Promise(() => {})); // 영원히 끝나지 않는 전송
      const target = await newRequest({ status: 'ACCEPTED', assignee: supporterA });

      const started = Date.now();
      const res = await call('post', `/requests/${target.id}/work-logs`, supporterA, { content: '작업', minutes: 1 });
      const elapsed = Date.now() - started;

      expect(res.status).toBe(201);
      expect(elapsed).toBeGreaterThanOrEqual(NOTIFY_WAIT_MS - 500);
      expect(elapsed).toBeLessThan(NOTIFY_WAIT_MS + 3000);
    },
    20000
  );
});
