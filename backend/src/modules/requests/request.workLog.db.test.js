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
let supportType;

const auth = (req, user) => (user ? req.set('Authorization', `Bearer ${tokenFor(user)}`) : req);
const submit = (id, user, body) => auth(request(app).post(`/api/requests/${id}/work-logs`), user).send(body);
const get = (path, user) => auth(request(app).get(path), user);
const post = (path, user) => auth(request(app).post(path), user);

const valid = { content: '월간 보고서 자동화 스크립트를 작성했습니다.', minutes: 90 };
const acceptedRequest = (overrides = {}) =>
  createRequest({ requester, supportType, status: 'ACCEPTED', assignee, ...overrides });
const events = (requestId) => prisma.requestEvent.findMany({ where: { requestId }, orderBy: { createdAt: 'asc' } });
const workLogs = (requestId) => prisma.workLog.findMany({ where: { requestId } });
const reload = (id) => prisma.request.findUnique({ where: { id } });

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

describe('POST /api/requests/:id/work-logs: 성공', () => {
  it('담당 지원자가 제출하면 1차 확인 대기가 되고 작업내역과 WORK_SUBMIT 이력이 남는다', async () => {
    const target = await acceptedRequest();
    const res = await submit(target.id, assignee, valid);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('FIRST_REVIEW');
    expect(res.body.workLogs).toHaveLength(1);
    expect(res.body.workLogs[0]).toMatchObject({
      round: 1,
      content: valid.content,
      minutes: 90,
      author: { id: assignee.id },
    });
    // 제출했으면 더 이상 입력·접수 취소 버튼이 나오면 안 된다.
    expect(res.body).toMatchObject({ canSubmitWork: false, canCancelAccept: false });

    expect((await reload(target.id)).status).toBe('FIRST_REVIEW');
    const logs = await workLogs(target.id);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ authorId: assignee.id, round: 1, minutes: 90 });
    expect((await events(target.id)).map((e) => [e.type, e.actorId])).toEqual([['WORK_SUBMIT', assignee.id]]);
  });

  it('작업 내용 앞뒤 공백은 제거되고, 소요 시간 0분도 제출할 수 있다', async () => {
    const target = await acceptedRequest();
    const res = await submit(target.id, assignee, { content: '  확인만 했습니다  ', minutes: 0 });

    expect(res.status).toBe(201);
    expect(res.body.workLogs[0]).toMatchObject({ content: '확인만 했습니다', minutes: 0 });
  });

  it('요청서 작성자와 관리자는 제출된 작업내역을 상세에서 볼 수 있다', async () => {
    const target = await acceptedRequest();
    await submit(target.id, assignee, valid);

    for (const viewer of [requester, admin, assignee]) {
      const detail = await get(`/api/requests/${target.id}`, viewer);
      expect(detail.status).toBe(200);
      expect(detail.body.workLogs.map((w) => w.content)).toEqual([valid.content]);
    }
  });

  it('요청서와 무관한 지원자는 상세를 볼 수 없다(404)', async () => {
    const target = await acceptedRequest();
    await submit(target.id, assignee, valid);
    expect((await get(`/api/requests/${target.id}`, otherSupporter)).status).toBe(404);
  });

  it('제출 요청에 상태·작성자·회차를 넣어도 무시된다', async () => {
    const target = await acceptedRequest();
    const res = await submit(target.id, assignee, {
      ...valid,
      status: 'COMPLETED',
      authorId: otherSupporter.id,
      round: 7,
    });

    expect(res.status).toBe(201);
    expect((await reload(target.id)).status).toBe('FIRST_REVIEW');
    expect((await workLogs(target.id))[0]).toMatchObject({ authorId: assignee.id, round: 1 });
  });
});

describe('POST /api/requests/:id/work-logs: 입력 검증(400)', () => {
  it.each([
    ['작업 내용이 없음', { minutes: 10 }, 'content'],
    ['작업 내용이 공백뿐', { content: '   ', minutes: 10 }, 'content'],
    ['소요 시간이 없음', { content: '작업' }, 'minutes'],
    ['소요 시간이 음수', { content: '작업', minutes: -5 }, 'minutes'],
    ['소요 시간이 소수', { content: '작업', minutes: 2.5 }, 'minutes'],
    ['소요 시간이 문자열', { content: '작업', minutes: '30' }, 'minutes'],
    ['소요 시간이 상한 초과', { content: '작업', minutes: 10001 }, 'minutes'],
  ])('%s', async (_name, body, field) => {
    const target = await acceptedRequest();
    const res = await submit(target.id, assignee, body);

    expect(res.status).toBe(400);
    expect(res.body.error.details).toHaveProperty(field);
    // 아무것도 바뀌지 않아야 한다.
    expect((await reload(target.id)).status).toBe('ACCEPTED');
    expect(await workLogs(target.id)).toHaveLength(0);
    expect(await events(target.id)).toHaveLength(0);
  });
});

describe('POST /api/requests/:id/work-logs: 권한과 상태', () => {
  it('토큰이 없으면 401, 없는 요청서는 404', async () => {
    const target = await acceptedRequest();
    expect((await submit(target.id, null, valid)).status).toBe(401);
    expect((await submit('does-not-exist', assignee, valid)).status).toBe(404);
  });

  it('요청자와 관리자는 제출할 수 없다(403)', async () => {
    const target = await acceptedRequest();
    expect((await submit(target.id, requester, valid)).status).toBe(403);
    expect((await submit(target.id, admin, valid)).status).toBe(403);
    expect((await reload(target.id)).status).toBe('ACCEPTED');
  });

  it('담당이 아닌 지원자는 제출할 수 없다(403)', async () => {
    const target = await acceptedRequest();
    const res = await submit(target.id, otherSupporter, valid);

    expect(res.status).toBe(403);
    expect((await reload(target.id)).status).toBe('ACCEPTED');
    expect(await workLogs(target.id)).toHaveLength(0);
  });

  it('접수되지 않은(담당자가 없는) 요청서에는 제출할 수 없다', async () => {
    const target = await createRequest({ requester, supportType });
    const res = await submit(target.id, assignee, valid);

    expect(res.status).toBe(403);
    expect((await reload(target.id)).status).toBe('SUBMITTED');
  });

  it.each(['FIRST_REVIEW', 'FINAL_REVIEW', 'COMPLETED'])(
    '담당 지원자라도 %s 상태에서는 제출할 수 없다(409)',
    async (status) => {
      const target = await acceptedRequest({ status });
      const res = await submit(target.id, assignee, valid);

      expect(res.status).toBe(409);
      expect((await reload(target.id)).status).toBe(status);
      expect(await workLogs(target.id)).toHaveLength(0);
      expect(await events(target.id)).toHaveLength(0);
    }
  );

  it('같은 제출이 두 번 들어와도(더블 클릭) 한 번만 반영된다', async () => {
    const target = await acceptedRequest();
    const results = await Promise.all([
      submit(target.id, assignee, valid),
      submit(target.id, assignee, valid),
      submit(target.id, assignee, valid),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect(await workLogs(target.id)).toHaveLength(1);
    expect(await events(target.id)).toHaveLength(1);
    expect((await reload(target.id)).status).toBe('FIRST_REVIEW');
  });

  it('작업내역을 제출한 뒤에는 접수를 취소할 수 없다(409)', async () => {
    const target = await acceptedRequest();
    await submit(target.id, assignee, valid);

    const res = await post(`/api/requests/${target.id}/cancel-accept`, assignee);
    expect(res.status).toBe(409);
    expect((await reload(target.id)).assigneeId).toBe(assignee.id);
  });

  it('제출과 접수 취소가 동시에 일어나도 결과가 일관된다', async () => {
    const target = await acceptedRequest();
    const [work, cancel] = await Promise.all([
      submit(target.id, assignee, valid),
      post(`/api/requests/${target.id}/cancel-accept`, assignee),
    ]);

    const saved = await reload(target.id);
    const logs = await workLogs(target.id);
    // 둘 중 먼저 반영된 쪽만 성공하고, 작업내역이 남은 요청서가 제출됨으로 돌아가는 일은 없다.
    if (work.status === 201) {
      expect(cancel.status).toBe(409);
      expect(saved).toMatchObject({ status: 'FIRST_REVIEW', assigneeId: assignee.id });
      expect(logs).toHaveLength(1);
    } else {
      expect(work.status).toBe(409);
      expect(cancel.status).toBe(200);
      expect(saved).toMatchObject({ status: 'SUBMITTED', assigneeId: null });
      expect(logs).toHaveLength(0);
    }
  });
});

describe('POST /api/requests/:id/work-logs: 원자성', () => {
  it('작업내역 저장이 실패하면 상태 변경과 이력도 함께 취소된다', async () => {
    const target = await acceptedRequest();
    // 같은 회차의 작업내역이 이미 있어 (requestId, round) 유일 제약에 걸리도록 일부러 비정상 데이터를 만든다.
    await prisma.workLog.create({
      data: { requestId: target.id, authorId: assignee.id, content: '이미 있음', minutes: 1, round: 1 },
    });

    const res = await submit(target.id, assignee, valid);

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await reload(target.id)).status).toBe('ACCEPTED');
    expect(await workLogs(target.id)).toHaveLength(1);
    expect(await events(target.id)).toHaveLength(0);
  });
});
