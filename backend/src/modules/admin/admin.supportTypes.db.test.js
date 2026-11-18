// DB 테스트: 전용 테스트 DB에서만 실행된다. (npm run test:db)
// vitest 는 ESM 전용이라 테스트 파일만 import 문법을 쓴다. 소스(CommonJS)는 기본 import 후 구조 분해한다.
import crypto from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../../app.js';
import factories from '../../test/factories.js';

const { prisma, createUser, createRequest, tokenFor, cleanup } = factories;

let admin;
let requester;
let supporter;
// 이 파일이 만드는 지원 유형의 이름은 모두 이 접두사로 시작한다. 테스트가 중간에 실패해 남긴 행도
// 접두사로 찾아 지울 수 있어서, 실패한 실행이 다음 실행을 망가뜨리지 않는다.
const NAME_PREFIX = 'adm-type-';
const createdTypeIds = [];

async function removeLeftoverTypes() {
  const mine = { name: { startsWith: NAME_PREFIX } };
  await prisma.request.deleteMany({ where: { supportType: mine } });
  await prisma.supportType.deleteMany({ where: mine });
}

const call = (method, path, user, body) => {
  const req = request(app)[method](`/api${path}`);
  if (user) req.set('Authorization', `Bearer ${tokenFor(user)}`);
  return body ? req.send(body) : req;
};
const uniqueName = (label = '') => `${NAME_PREFIX}${label}${crypto.randomBytes(4).toString('hex')}`;
const addType = async (name = uniqueName()) => {
  const res = await call('post', '/admin/support-types', admin, { name });
  if (res.status === 201) createdTypeIds.push(res.body.id);
  return res;
};
const typeRow = (id) => prisma.supportType.findUnique({ where: { id } });

beforeAll(async () => {
  // 안전장치: 앱이 실제로 테스트 DB를 쓰고 있는지 한 번 더 확인한다.
  const [{ db }] = await prisma.$queryRaw`select current_database() as db`;
  expect(db.endsWith('_test')).toBe(true);
  // 이 파일은 "사용 중인 유형이 하나도 안 남는 경우"를 시험하므로 테스트 DB에 다른 유형이 없어야 한다.
  // (이전 실행이 중간에 실패해 남긴 이 파일의 유형은 먼저 치운다.)
  await removeLeftoverTypes();
  expect(await prisma.supportType.count()).toBe(0);

  [admin, requester, supporter] = await Promise.all([
    createUser('ADMIN'),
    createUser('REQUESTER'),
    createUser('SUPPORTER'),
  ]);
});

afterAll(async () => {
  await cleanup();
  await removeLeftoverTypes();
  await prisma.$disconnect();
});

describe('POST /api/admin/support-types', () => {
  it('유형을 추가하면 201이고 사용 중 상태로 맨 뒤에 붙는다', async () => {
    const first = await addType();
    const second = await addType();

    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ active: true, requestCount: 0 });
    expect(second.body.sortOrder).toBe(first.body.sortOrder + 1);
  });

  it('이름 앞뒤 공백은 제거해 저장한다', async () => {
    const name = uniqueName();
    const res = await addType(`  ${name}  `);
    expect(res.status).toBe(201);
    expect(res.body.name).toBe(name);
  });

  it('같은 이름은 409이고 항목별 오류가 나온다', async () => {
    const name = uniqueName();
    await addType(name);
    const dup = await addType(name);

    expect(dup.status).toBe(409);
    expect(dup.body.error.details).toHaveProperty('name');
    expect(await prisma.supportType.count({ where: { name } })).toBe(1);
  });

  it('이름이 비었거나 너무 길면 400', async () => {
    expect((await addType('   ')).status).toBe(400);
    expect((await addType('a'.repeat(51))).status).toBe(400);
    expect((await call('post', '/admin/support-types', admin, {})).status).toBe(400);
  });

  it('관리자가 아니면 403, 토큰이 없으면 401', async () => {
    const body = { name: uniqueName() };
    expect((await call('post', '/admin/support-types', requester, body)).status).toBe(403);
    expect((await call('post', '/admin/support-types', supporter, body)).status).toBe(403);
    expect((await call('post', '/admin/support-types', null, body)).status).toBe(401);
    expect(await prisma.supportType.count({ where: { name: body.name } })).toBe(0);
  });
});

describe('GET /api/admin/support-types', () => {
  it('사용 중이 아닌 유형까지 순서대로 보여주고 쓰인 요청서 수를 알려준다', async () => {
    const used = (await addType()).body;
    const hidden = (await addType()).body;
    await createRequest({ requester, supportType: { id: used.id } });
    await call('patch', `/admin/support-types/${hidden.id}`, admin, { active: false });

    const res = await call('get', '/admin/support-types', admin);
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.map((t) => [t.id, t]));
    expect(byId[used.id]).toMatchObject({ active: true, requestCount: 1 });
    expect(byId[hidden.id]).toMatchObject({ active: false, requestCount: 0 });

    const orders = res.body.map((t) => t.sortOrder);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it('관리자가 아니면 403', async () => {
    expect((await call('get', '/admin/support-types', requester)).status).toBe(403);
  });
});

describe('PATCH /api/admin/support-types/:id', () => {
  it('이름을 바꿀 수 있다', async () => {
    const type = (await addType()).body;
    const name = uniqueName('renamed-');
    const res = await call('patch', `/admin/support-types/${type.id}`, admin, { name });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe(name);
    expect((await typeRow(type.id)).name).toBe(name);
  });

  it('삭제 대신 비활성화하고 다시 활성화할 수 있다(행은 남는다)', async () => {
    const keep = (await addType()).body; // 마지막 하나가 되지 않도록 다른 유형을 하나 더 둔다
    const type = (await addType()).body;

    const off = await call('patch', `/admin/support-types/${type.id}`, admin, { active: false });
    expect(off.status).toBe(200);
    expect(off.body.active).toBe(false);
    expect(await typeRow(type.id)).not.toBeNull();

    const on = await call('patch', `/admin/support-types/${type.id}`, admin, { active: true });
    expect(on.body.active).toBe(true);
    expect(keep.id).toBeDefined();
  });

  it('표시 순서를 바꾸면 목록 순서에 반영된다', async () => {
    const a = (await addType()).body;
    const b = (await addType()).body;
    // a를 맨 뒤로 보내고 b를 맨 앞으로 보낸다.
    await call('patch', `/admin/support-types/${a.id}`, admin, { sortOrder: 9000 });
    await call('patch', `/admin/support-types/${b.id}`, admin, { sortOrder: 0 });

    const list = await call('get', '/admin/support-types', admin);
    const ids = list.body.map((t) => t.id);
    expect(ids.indexOf(b.id)).toBeLessThan(ids.indexOf(a.id));
  });

  it('이미 있는 이름으로 바꾸면 409이고 이름은 그대로다', async () => {
    const a = (await addType()).body;
    const b = (await addType()).body;
    const res = await call('patch', `/admin/support-types/${b.id}`, admin, { name: a.name });

    expect(res.status).toBe(409);
    expect((await typeRow(b.id)).name).toBe(b.name);
  });

  it('없는 유형은 404, 바꿀 항목이 없거나 값이 이상하면 400', async () => {
    const type = (await addType()).body;
    expect((await call('patch', '/admin/support-types/does-not-exist', admin, { active: false })).status).toBe(404);
    expect((await call('patch', `/admin/support-types/${type.id}`, admin, {})).status).toBe(400);
    expect((await call('patch', `/admin/support-types/${type.id}`, admin, { active: 'no' })).status).toBe(400);
    expect((await call('patch', `/admin/support-types/${type.id}`, admin, { sortOrder: -3 })).status).toBe(400);
  });

  it('마지막 하나 남은 사용 중 유형은 비활성화할 수 없다(409)', async () => {
    // 이 파일이 만든 유형 중 사용 중인 것만 하나 남기고 모두 끈다.
    const actives = await prisma.supportType.findMany({ where: { active: true } });
    const [last, ...others] = actives;
    for (const type of others) {
      await prisma.supportType.update({ where: { id: type.id }, data: { active: false } });
    }

    const res = await call('patch', `/admin/support-types/${last.id}`, admin, { active: false });
    expect(res.status).toBe(409);
    expect((await typeRow(last.id)).active).toBe(true);

    // 이미 비활성인 유형을 다시 끄는 것은 문제없고, 하나를 켜면 마지막 것을 끌 수 있다.
    const other = others[0];
    expect((await call('patch', `/admin/support-types/${other.id}`, admin, { active: false })).status).toBe(200);
    await call('patch', `/admin/support-types/${other.id}`, admin, { active: true });
    expect((await call('patch', `/admin/support-types/${last.id}`, admin, { active: false })).status).toBe(200);
    await prisma.supportType.updateMany({ where: { id: { in: createdTypeIds } }, data: { active: true } });
  });

  it('관리자가 아니면 403', async () => {
    const type = (await addType()).body;
    expect((await call('patch', `/admin/support-types/${type.id}`, requester, { active: false })).status).toBe(403);
    expect((await typeRow(type.id)).active).toBe(true);
  });
});

describe('비활성화된 유형이 요청서에 미치는 영향', () => {
  const body = (supportTypeId) => ({
    supportTypeId,
    title: '제목',
    content: '내용',
    department: '부서',
    contactName: '이름',
    contactPhone: '010-1234-5678',
    interviewAt: '2026-11-20T10:00:00.000Z',
    desiredDate: '2026-12-01',
  });

  it('작성 화면의 선택 목록(GET /api/support-types)에는 사용 중인 유형만 나온다', async () => {
    const on = (await addType()).body;
    const off = (await addType()).body;
    await call('patch', `/admin/support-types/${off.id}`, admin, { active: false });

    const res = await call('get', '/support-types', requester);
    const ids = res.body.map((t) => t.id);
    expect(ids).toContain(on.id);
    expect(ids).not.toContain(off.id);
  });

  it('비활성 유형으로는 새 요청서를 작성할 수 없다(400)', async () => {
    await addType();
    const off = (await addType()).body;
    await call('patch', `/admin/support-types/${off.id}`, admin, { active: false });

    const res = await call('post', '/requests', requester, body(off.id));
    expect(res.status).toBe(400);
    expect(res.body.error.details).toHaveProperty('supportTypeId');
  });

  it('이미 그 유형으로 만든 요청서는 유형이 비활성화된 뒤에도 다른 항목을 고칠 수 있다', async () => {
    await addType();
    const type = (await addType()).body;
    const created = await call('post', '/requests', requester, body(type.id));
    expect(created.status).toBe(201);

    await call('patch', `/admin/support-types/${type.id}`, admin, { active: false });

    // 편집 화면은 유형도 함께 보내므로, 바뀌지 않은 비활성 유형이 거부되면 안 된다.
    const res = await call('patch', `/requests/${created.body.id}`, requester, {
      title: '제목만 수정',
      supportTypeId: type.id,
    });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('제목만 수정');
    expect(res.body.supportType.id).toBe(type.id);
  });

  it('요청서의 유형을 비활성 유형으로 바꾸는 것은 거부된다(400)', async () => {
    const live = (await addType()).body;
    const off = (await addType()).body;
    const created = await call('post', '/requests', requester, body(live.id));
    await call('patch', `/admin/support-types/${off.id}`, admin, { active: false });

    const res = await call('patch', `/requests/${created.body.id}`, requester, { supportTypeId: off.id });
    expect(res.status).toBe(400);
    expect((await prisma.request.findUnique({ where: { id: created.body.id } })).supportTypeId).toBe(live.id);
  });
});
