// DB 테스트: 전용 테스트 DB에서만 실행된다. (npm run test:db)
// 희망 완료일 하루 전 알림: 누구에게, 언제, 몇 번 가는가. 실제 푸시 서버로는 보내지 않는다(가짜 전송기에 기록).
// vitest 는 ESM 전용이라 테스트 파일만 import 문법을 쓴다. 소스(CommonJS)는 기본 import 후 구조 분해한다.
import crypto from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import app from '../app.js';
import factories from '../test/factories.js';
import pushService from '../modules/push/push.service.js';
import dueReminder from './dueReminder.js';

const { prisma, createUser, createSupportType, createRequest, tokenFor, cleanup } = factories;
const { runDueReminders } = dueReminder;

// 기준 시각: 한국 2031-03-10 11:00 → 한국 시간으로 "내일"은 2031-03-11 (다른 테스트가 쓰지 않는 먼 날짜)
const NOW = new Date('2031-03-10T02:00:00Z');
const TOMORROW = new Date('2031-03-11T00:00:00.000Z');
const TODAY = new Date('2031-03-10T00:00:00.000Z');
const DAY_AFTER = new Date('2031-03-12T00:00:00.000Z');

let requester;
let supporterA;
let supporterB;
let admin;
let otherAdmin;
let supportType;
let dev;
let sent = [];

const call = (method, path, user, body) => {
  const req = request(app)[method](`/api${path}`);
  if (user) req.set('Authorization', `Bearer ${tokenFor(user)}`);
  return body ? req.send(body) : req;
};

async function subscribe(user, label) {
  const endpoint = `https://push.example.test/${label}-${crypto.randomBytes(4).toString('hex')}`;
  const res = await call('post', '/push/subscribe', user, { endpoint, keys: { p256dh: 'p', auth: 'a' } });
  expect(res.status).toBe(201);
  return endpoint;
}

const endpointsSent = () => sent.map((s) => s.endpoint).sort();
const sortedDevices = (...names) => names.map((n) => dev[n]).sort();
const open = (overrides = {}) => createRequest({ requester, supportType, desiredDate: TOMORROW, ...overrides });
const sentAtOf = async (id) => (await prisma.request.findUnique({ where: { id } })).dueReminderSentAt;

beforeAll(async () => {
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
  pushService.setTransport(async (subscription, body) => {
    sent.push({ endpoint: subscription.endpoint, payload: JSON.parse(body) });
  });
  await prisma.pushSubscription.deleteMany({
    where: { userId: { in: [requester.id, supporterA.id, supporterB.id, admin.id, otherAdmin.id] } },
  });
  dev = {
    requester: await subscribe(requester, 'requester'),
    supporterA: await subscribe(supporterA, 'supA'),
    supporterB: await subscribe(supporterB, 'supB'),
    admin: await subscribe(admin, 'admin'),
    otherAdmin: await subscribe(otherAdmin, 'otherAdmin'),
  };
  // 이전 테스트가 남긴 요청서는 지운다(이 파일의 사용자 것만).
  await prisma.request.deleteMany({ where: { requesterId: requester.id } });
});

afterEach(() => {
  pushService.resetTransport();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('누구에게 보내는가: 지금 처리할 차례인 사람', () => {
  it('아직 접수되지 않은(제출됨) 요청서는 모든 지원자와 관리자에게 간다(요청자는 제외)', async () => {
    const target = await open({ status: 'SUBMITTED' });
    const result = await runDueReminders(NOW);

    expect(result).toEqual({ skipped: false, found: 1, sent: 1 });
    expect(endpointsSent()).toEqual(sortedDevices('supporterA', 'supporterB', 'admin', 'otherAdmin'));
    expect(sent[0].payload).toEqual({
      title: '내일이 희망 완료일인데 아직 접수되지 않았습니다',
      body: target.title,
      url: '/requests',
    });
  });

  it.each([
    ['ACCEPTED', ['supporterA'], '/work'],
    ['REWORK', ['supporterA'], '/work'],
    ['FIRST_REVIEW', ['requester'], '/review'],
    ['FINAL_REVIEW', ['admin', 'otherAdmin'], '/final-review'],
  ])('%s 상태는 해당 차례의 사람에게만 간다', async (status, who, urlSuffix) => {
    const target = await open({ status, assignee: supporterA });
    await runDueReminders(NOW);

    expect(endpointsSent()).toEqual(sortedDevices(...who));
    expect(sent[0].payload.url).toBe(`/requests/${target.id}${urlSuffix}`);
  });

  it('완료된 요청서는 보내지 않고 기록도 남기지 않는다', async () => {
    const target = await open({ status: 'COMPLETED', assignee: supporterA });
    const result = await runDueReminders(NOW);

    expect(result.found).toBe(0);
    expect(sent).toEqual([]);
    expect(await sentAtOf(target.id)).toBeNull();
  });
});

describe('언제 보내는가', () => {
  it('희망 완료일이 한국 시간으로 내일인 요청서만 대상이다(오늘·모레는 아니다)', async () => {
    await open({ status: 'ACCEPTED', assignee: supporterA, desiredDate: TODAY });
    await open({ status: 'ACCEPTED', assignee: supporterA, desiredDate: DAY_AFTER });
    const result = await runDueReminders(NOW);

    expect(result.found).toBe(0);
    expect(sent).toEqual([]);
  });

  it('한국 시간 오전 9시 전에는 보내지 않고, 9시 정각부터 보낸다', async () => {
    const target = await open({ status: 'ACCEPTED', assignee: supporterA });

    // 한국 08:59 (UTC 전날 23:59)
    const early = await runDueReminders(new Date('2031-03-09T23:59:00Z'));
    expect(early).toEqual({ skipped: true, found: 0, sent: 0 });
    expect(sent).toEqual([]);
    expect(await sentAtOf(target.id)).toBeNull();

    // 한국 09:00 (UTC 00:00)
    const onTime = await runDueReminders(new Date('2031-03-10T00:00:00Z'));
    expect(onTime.sent).toBe(1);
    expect(endpointsSent()).toEqual(sortedDevices('supporterA'));
  });
});

describe('한 요청서에 한 번만 간다', () => {
  it('두 번 실행해도 두 번째는 보내지 않고, 보낸 시각이 기록된다', async () => {
    const target = await open({ status: 'ACCEPTED', assignee: supporterA });

    const first = await runDueReminders(NOW);
    const second = await runDueReminders(new Date(NOW.getTime() + 3600_000));

    expect(first.sent).toBe(1);
    expect(second).toEqual({ skipped: false, found: 0, sent: 0 });
    expect(sent).toHaveLength(1);
    expect((await sentAtOf(target.id)).toISOString()).toBe(NOW.toISOString());
  });

  it('동시에 두 번 실행돼도 한 번만 간다', async () => {
    await open({ status: 'ACCEPTED', assignee: supporterA });

    const results = await Promise.all([runDueReminders(NOW), runDueReminders(NOW)]);

    expect(results.reduce((sum, r) => sum + r.sent, 0)).toBe(1);
    expect(sent).toHaveLength(1);
  });

  it('여러 요청서를 한꺼번에 처리하고 각각 한 번씩 보낸다', async () => {
    await open({ status: 'ACCEPTED', assignee: supporterA });
    await open({ status: 'FIRST_REVIEW', assignee: supporterA });

    const result = await runDueReminders(NOW);

    expect(result).toEqual({ skipped: false, found: 2, sent: 2 });
    expect(endpointsSent()).toEqual(sortedDevices('supporterA', 'requester'));
  });

  it('보내는 중 오류가 나도 실행은 정상으로 끝난다(알림은 부가 기능)', async () => {
    pushService.setTransport(async () => {
      throw new Error('push server down');
    });
    const target = await open({ status: 'ACCEPTED', assignee: supporterA });

    const result = await runDueReminders(NOW);

    expect(result.sent).toBe(1); // 선점은 했고 전송이 실패한 것이다
    expect(await sentAtOf(target.id)).not.toBeNull();
  });
});

describe('희망 완료일을 고치면 다시 보낼 수 있다', () => {
  it('희망 완료일을 바꾸면 보낸 기록이 비워진다', async () => {
    const target = await open({ status: 'SUBMITTED', dueReminderSentAt: NOW });

    const res = await call('patch', `/requests/${target.id}`, requester, { desiredDate: '2031-03-20' });

    expect(res.status).toBe(200);
    expect(await sentAtOf(target.id)).toBeNull();
  });

  it('다른 항목만 고치면 기록은 그대로다', async () => {
    const target = await open({ status: 'SUBMITTED', dueReminderSentAt: NOW });

    const res = await call('patch', `/requests/${target.id}`, requester, { title: '제목만 변경' });

    expect(res.status).toBe(200);
    expect((await sentAtOf(target.id)).toISOString()).toBe(NOW.toISOString());
  });
});

describe('POST /api/cron/reminders', () => {
  it('비밀값이 없거나 틀리면 401', async () => {
    expect((await request(app).post('/api/cron/reminders')).status).toBe(401);
    expect((await request(app).post('/api/cron/reminders').set('Authorization', 'Bearer wrong')).status).toBe(401);
  });

  it('올바른 비밀값이면 실행 결과를 돌려준다', async () => {
    const res = await request(app)
      .post('/api/cron/reminders')
      .set('Authorization', `Bearer ${process.env.CRON_SECRET}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.skipped).toBe('boolean');
    expect(res.body).toHaveProperty('found');
    expect(res.body).toHaveProperty('sent');
  });
});
