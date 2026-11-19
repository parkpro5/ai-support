// DB 테스트: 전용 테스트 DB에서만 실행된다. (npm run test:db)
// 1) 지원자는 접수하기 전에도 접수 가능한 요청서의 연락처를 목록·상세에서 볼 수 있다.
// 2) 새 요청서 작성 화면의 기본값(로그인한 사람의 이름, 가장 최근에 쓴 소속).
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../../app.js';
import factories from '../../test/factories.js';

const { prisma, createUser, createSupportType, createRequest, tokenFor, cleanup } = factories;

let requester;
let otherRequester;
let supporter;
let otherSupporter;
let admin;
let supportType;

const PHONE = '010-9876-5432';
const call = (path, user, method = 'get') => {
  const req = request(app)[method](`/api${path}`);
  if (user) req.set('Authorization', `Bearer ${tokenFor(user)}`);
  return req;
};
const open = (overrides = {}) => createRequest({ requester, supportType, contactName: '김담당', contactPhone: PHONE, ...overrides });
const inList = (res, id) => res.body.items.find((item) => item.id === id);

beforeAll(async () => {
  const [{ db }] = await prisma.$queryRaw`select current_database() as db`;
  expect(db.endsWith('_test')).toBe(true);

  [requester, otherRequester, supporter, otherSupporter, admin] = await Promise.all([
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

describe('접수 전 연락처 조회', () => {
  it('[요구사항] 지원자의 "접수 가능" 목록 카드에 연락 담당자·전화번호·착수일시가 들어 있다', async () => {
    const target = await open();

    const res = await call('/requests?scope=available&pageSize=100', supporter);

    expect(res.status).toBe(200);
    expect(inList(res, target.id)).toMatchObject({
      contactName: '김담당',
      contactPhone: PHONE,
      interviewAt: target.interviewAt.toISOString(),
      desiredDate: '2026-12-01',
    });
  });

  it('접수 가능한 요청서의 상세에서도 지원자에게 연락처가 보인다', async () => {
    const target = await open();
    const res = await call(`/requests/${target.id}`, supporter);
    expect(res.status).toBe(200);
    expect(res.body.contactPhone).toBe(PHONE);
  });

  it('여러 지원자가 같은 요청서의 연락처를 볼 수 있다(접수 전이므로)', async () => {
    const target = await open();
    for (const user of [supporter, otherSupporter]) {
      expect((await call(`/requests/${target.id}`, user)).body.contactPhone).toBe(PHONE);
    }
  });

  it('작성자·관리자의 목록에도 연락처가 보이고, 다른 요청자는 그 요청서를 목록에서도 상세에서도 볼 수 없다', async () => {
    const target = await open();

    expect(inList(await call('/requests?pageSize=100', requester), target.id).contactPhone).toBe(PHONE);
    expect(inList(await call('/requests?pageSize=100', admin), target.id).contactPhone).toBe(PHONE);
    expect(inList(await call('/requests?pageSize=100', otherRequester), target.id)).toBeUndefined();
    expect((await call(`/requests/${target.id}`, otherRequester)).status).toBe(404);
  });

  it('다른 지원자가 접수한 요청서는 더 이상 보이지 않고, 연락처도 새지 않는다', async () => {
    const target = await open();
    await call(`/requests/${target.id}/accept`, supporter, 'post');

    const asOther = await call(`/requests/${target.id}`, otherSupporter);
    expect(asOther.status).toBe(404);
    expect(JSON.stringify(asOther.body)).not.toContain(PHONE);
    const list = await call('/requests?scope=available&pageSize=100', otherSupporter);
    expect(inList(list, target.id)).toBeUndefined();
    expect(JSON.stringify(list.body)).not.toContain(target.id);
  });

  it('접수한 담당 지원자는 "내 담당" 목록에서 계속 연락처를 본다', async () => {
    const target = await open();
    await call(`/requests/${target.id}/accept`, supporter, 'post');

    const mine = await call('/requests?scope=mine&pageSize=100', supporter);
    expect(inList(mine, target.id).contactPhone).toBe(PHONE);
  });

  it('접수를 취소해 다시 제출됨이 되면 다른 지원자에게 연락처가 다시 보인다', async () => {
    const target = await open();
    await call(`/requests/${target.id}/accept`, supporter, 'post');
    await call(`/requests/${target.id}/cancel-accept`, supporter, 'post');

    const res = await call(`/requests/${target.id}`, otherSupporter);
    expect(res.status).toBe(200);
    expect(res.body.contactPhone).toBe(PHONE);
    // 이력은 여전히 숨긴다.
    expect(res.body.events).toEqual([]);
  });

  it('로그인하지 않으면 401', async () => {
    expect((await call('/requests')).status).toBe(401);
  });
});

describe('GET /api/requests/form-defaults — 작성 화면 기본값', () => {
  it('처음 작성하는 사람은 이름만 기본값이고 소속은 null이다', async () => {
    const fresh = await createUser('REQUESTER');
    const res = await call('/requests/form-defaults', fresh);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ contactName: fresh.name, department: null });
  });

  it('가장 최근에 작성한 요청서의 소속을 기본값으로 준다', async () => {
    const user = await createUser('REQUESTER');
    await createRequest({ requester: user, supportType, department: '예전 부서', createdAt: new Date('2026-01-01T00:00:00Z') });
    await createRequest({ requester: user, supportType, department: '최근 부서', createdAt: new Date('2026-06-01T00:00:00Z') });
    await createRequest({ requester: user, supportType, department: '중간 부서', createdAt: new Date('2026-03-01T00:00:00Z') });

    const res = await call('/requests/form-defaults', user);

    expect(res.body.department).toBe('최근 부서');
  });

  it('다른 사람이 쓴 요청서의 소속은 쓰지 않는다', async () => {
    const user = await createUser('REQUESTER');
    await createRequest({ requester: otherRequester, supportType, department: '남의 부서' });

    expect((await call('/requests/form-defaults', user)).body.department).toBeNull();
  });

  it('요청서의 담당자 이름이 아니라 로그인한 계정의 이름을 준다', async () => {
    const user = await createUser('REQUESTER');
    await createRequest({ requester: user, supportType, contactName: '다른 사람' });

    expect((await call('/requests/form-defaults', user)).body.contactName).toBe(user.name);
  });

  it('관리자도 쓸 수 있다(관리자도 요청서를 작성할 수 있다)', async () => {
    const res = await call('/requests/form-defaults', admin);
    expect(res.status).toBe(200);
    expect(res.body.contactName).toBe(admin.name);
  });

  it('지원자는 요청서를 작성하지 않으므로 403, 로그인 없이는 401', async () => {
    expect((await call('/requests/form-defaults', supporter)).status).toBe(403);
    expect((await call('/requests/form-defaults')).status).toBe(401);
  });

  it('"form-defaults" 가 요청서 id 로 해석되지 않는다(404 가 아니다)', async () => {
    const res = await call('/requests/form-defaults', requester);
    expect(res.status).toBe(200);
  });
});
