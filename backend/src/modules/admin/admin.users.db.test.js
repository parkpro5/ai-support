// DB 테스트: 전용 테스트 DB에서만 실행된다. (npm run test:db)
// vitest 는 ESM 전용이라 테스트 파일만 import 문법을 쓴다. 소스(CommonJS)는 기본 import 후 구조 분해한다.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../../app.js';
import factories from '../../test/factories.js';

const { prisma, createUser, createSupportType, createRequest, tokenFor, cleanup } = factories;

let admin;
let otherAdmin;
let supportType;

const call = (method, path, user, body) => {
  const req = request(app)[method](`/api${path}`);
  if (user) req.set('Authorization', `Bearer ${tokenFor(user)}`);
  return body ? req.send(body) : req;
};
const setRole = (userId, actor, role) => call('patch', `/admin/users/${userId}/role`, actor, { role });
const roleOf = async (id) => (await prisma.user.findUnique({ where: { id } })).role;
/** 팩토리가 만든 이메일에서 고유 문자열(태그)을 꺼내 검색에 쓴다. */
const tagOf = (user) => user.email.replace('test-', '').replace('@example.com', '');

beforeAll(async () => {
  // 안전장치: 앱이 실제로 테스트 DB를 쓰고 있는지 한 번 더 확인한다.
  const [{ db }] = await prisma.$queryRaw`select current_database() as db`;
  expect(db.endsWith('_test')).toBe(true);

  [admin, otherAdmin] = await Promise.all([createUser('ADMIN'), createUser('ADMIN')]);
  supportType = await createSupportType();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('GET /api/admin/users', () => {
  it('관리자는 사용자 목록을 볼 수 있다(이메일, 이름, 역할 포함)', async () => {
    const user = await createUser('REQUESTER');
    const res = await call('get', `/admin/users?q=${tagOf(user)}`, admin);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0]).toMatchObject({ id: user.id, email: user.email, name: user.name, role: 'REQUESTER' });
    expect(res.body.items[0]).not.toHaveProperty('googleId');
  });

  it('역할로 거르고, 이름·이메일 일부와 대소문자 구분 없이 검색할 수 있다', async () => {
    const supporter = await createUser('SUPPORTER');
    const found = await call('get', `/admin/users?role=SUPPORTER&q=${tagOf(supporter).toUpperCase()}`, admin);
    expect(found.body.items.map((u) => u.id)).toEqual([supporter.id]);

    const wrongRole = await call('get', `/admin/users?role=REQUESTER&q=${tagOf(supporter)}`, admin);
    expect(wrongRole.body.total).toBe(0);
  });

  it('페이지 단위로 나눠 보여준다', async () => {
    const a = await createUser('REQUESTER');
    await createUser('REQUESTER');
    const res = await call('get', '/admin/users?role=REQUESTER&pageSize=1&page=1', admin);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.total).toBeGreaterThanOrEqual(2);
    expect(a.id).toBeDefined();
  });

  it('잘못된 조건은 400', async () => {
    expect((await call('get', '/admin/users?role=ROOT', admin)).status).toBe(400);
    expect((await call('get', '/admin/users?pageSize=101', admin)).status).toBe(400);
  });

  it('관리자가 아니면 403, 토큰이 없으면 401', async () => {
    const requester = await createUser('REQUESTER');
    const supporter = await createUser('SUPPORTER');
    expect((await call('get', '/admin/users', requester)).status).toBe(403);
    expect((await call('get', '/admin/users', supporter)).status).toBe(403);
    expect((await call('get', '/admin/users')).status).toBe(401);
  });
});

describe('PATCH /api/admin/users/:id/role', () => {
  it('요청자를 지원자로 지정하고 다시 요청자로 되돌릴 수 있다', async () => {
    const user = await createUser('REQUESTER');

    const up = await setRole(user.id, admin, 'SUPPORTER');
    expect(up.status).toBe(200);
    expect(up.body).toMatchObject({ id: user.id, role: 'SUPPORTER' });
    expect(await roleOf(user.id)).toBe('SUPPORTER');

    const down = await setRole(user.id, admin, 'REQUESTER');
    expect(down.status).toBe(200);
    expect(await roleOf(user.id)).toBe('REQUESTER');
  });

  it('이미 그 역할이면 그대로 200이다', async () => {
    const user = await createUser('SUPPORTER');
    const res = await setRole(user.id, admin, 'SUPPORTER');
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('SUPPORTER');
  });

  it('관리자 계정의 역할은 바꿀 수 없다(403)', async () => {
    for (const role of ['REQUESTER', 'SUPPORTER']) {
      const res = await setRole(otherAdmin.id, admin, role);
      expect(res.status).toBe(403);
    }
    expect(await roleOf(otherAdmin.id)).toBe('ADMIN');
    // 자기 자신도 마찬가지다.
    expect((await setRole(admin.id, admin, 'REQUESTER')).status).toBe(403);
    expect(await roleOf(admin.id)).toBe('ADMIN');
  });

  it('관리자 역할은 지정할 수 없다(400)', async () => {
    const user = await createUser('REQUESTER');
    const res = await setRole(user.id, admin, 'ADMIN');
    expect(res.status).toBe(400);
    expect(res.body.error.details).toHaveProperty('role');
    expect(await roleOf(user.id)).toBe('REQUESTER');
  });

  it('없는 사용자는 404, 역할이 없거나 이상하면 400', async () => {
    expect((await setRole('does-not-exist', admin, 'SUPPORTER')).status).toBe(404);
    const user = await createUser('REQUESTER');
    expect((await call('patch', `/admin/users/${user.id}/role`, admin, {})).status).toBe(400);
    expect((await call('patch', `/admin/users/${user.id}/role`, admin, { role: 'supporter' })).status).toBe(400);
  });

  it('관리자가 아니면 바꿀 수 없다: 요청자가 자기 자신을 지원자로 올리는 시도도 403', async () => {
    const requester = await createUser('REQUESTER');
    const supporter = await createUser('SUPPORTER');
    expect((await setRole(requester.id, requester, 'SUPPORTER')).status).toBe(403);
    expect((await setRole(requester.id, supporter, 'SUPPORTER')).status).toBe(403);
    expect((await setRole(requester.id, null, 'SUPPORTER')).status).toBe(401);
    expect(await roleOf(requester.id)).toBe('REQUESTER');
  });
});

describe('지원자 지정 전후의 접수 권한', () => {
  it('지정 전에는 접수가 403이고, 지정 후에는 같은 토큰으로 바로 접수할 수 있다', async () => {
    const requester = await createUser('REQUESTER');
    const candidate = await createUser('REQUESTER');
    const target = await createRequest({ requester, supportType });

    // 지정 전
    expect((await call('post', `/requests/${target.id}/accept`, candidate)).status).toBe(403);

    // 관리자가 지원자로 지정. 후보는 다시 로그인하지 않았고 토큰도 그대로(요청자 역할을 담은 낡은 토큰)이다.
    const staleToken = tokenFor(candidate);
    expect((await setRole(candidate.id, admin, 'SUPPORTER')).status).toBe(200);

    const res = await request(app).post(`/api/requests/${target.id}/accept`).set('Authorization', `Bearer ${staleToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ACCEPTED', assignee: { id: candidate.id } });
  });

  it('지정이 해제되면 낡은 토큰으로도 즉시 접수할 수 없다', async () => {
    const requester = await createUser('REQUESTER');
    const supporter = await createUser('SUPPORTER');
    const target = await createRequest({ requester, supportType });
    const staleToken = tokenFor(supporter); // 지원자 역할을 담은 토큰

    expect((await setRole(supporter.id, admin, 'REQUESTER')).status).toBe(200);

    const res = await request(app).post(`/api/requests/${target.id}/accept`).set('Authorization', `Bearer ${staleToken}`);
    expect(res.status).toBe(403);
    expect((await prisma.request.findUnique({ where: { id: target.id } })).status).toBe('SUBMITTED');
  });

  it('요청자로 되돌려진 사용자는 요청서를 작성할 수 있고 지원자로 올려진 사용자는 작성할 수 없다', async () => {
    const user = await createUser('SUPPORTER');
    const body = {
      supportTypeId: supportType.id,
      title: '제목',
      content: '내용',
      department: '부서',
      contactName: '이름',
      contactPhone: '010-1234-5678',
      interviewAt: '2026-11-20T10:00:00.000Z',
      desiredDate: '2026-12-01',
    };
    expect((await call('post', '/requests', user, body)).status).toBe(403);
    await setRole(user.id, admin, 'REQUESTER');
    expect((await request(app).post('/api/requests').set('Authorization', `Bearer ${tokenFor(user)}`).send(body)).status).toBe(201);
  });

  it('삭제된 사용자의 토큰은 거부된다(401)', async () => {
    const user = await createUser('REQUESTER');
    const token = tokenFor(user);
    await prisma.user.delete({ where: { id: user.id } });

    const res = await request(app).get('/api/requests').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });
});

describe('진행 중인 담당 요청서가 있는 지원자의 해제', () => {
  it.each(['ACCEPTED', 'FIRST_REVIEW', 'FINAL_REVIEW', 'REWORK'])(
    '%s 상태의 담당 요청서가 있으면 해제할 수 없고(409) 역할은 그대로다',
    async (status) => {
      const requester = await createUser('REQUESTER');
      const supporter = await createUser('SUPPORTER');
      await createRequest({ requester, supportType, status, assignee: supporter });

      const res = await setRole(supporter.id, admin, 'REQUESTER');
      expect(res.status).toBe(409);
      expect(res.body.error.message).toContain('1건');
      expect(await roleOf(supporter.id)).toBe('SUPPORTER');
    }
  );

  it('담당 요청서가 모두 완료되었다면 해제할 수 있다', async () => {
    const requester = await createUser('REQUESTER');
    const supporter = await createUser('SUPPORTER');
    await createRequest({ requester, supportType, status: 'COMPLETED', assignee: supporter });

    expect((await setRole(supporter.id, admin, 'REQUESTER')).status).toBe(200);
    expect(await roleOf(supporter.id)).toBe('REQUESTER');
  });

  it('진행 중인 요청서 개수를 메시지로 알려준다', async () => {
    const requester = await createUser('REQUESTER');
    const supporter = await createUser('SUPPORTER');
    await createRequest({ requester, supportType, status: 'ACCEPTED', assignee: supporter });
    await createRequest({ requester, supportType, status: 'REWORK', assignee: supporter });
    await createRequest({ requester, supportType, status: 'COMPLETED', assignee: supporter });

    const res = await setRole(supporter.id, admin, 'REQUESTER');
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('2건');
  });

  it('요청자를 지원자로 올릴 때는 이런 제한이 없다', async () => {
    const requester = await createUser('REQUESTER');
    await createRequest({ requester, supportType, status: 'FIRST_REVIEW' });
    expect((await setRole(requester.id, admin, 'SUPPORTER')).status).toBe(200);
  });
});
