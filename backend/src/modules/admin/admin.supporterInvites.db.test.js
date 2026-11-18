// DB 테스트: 전용 테스트 DB에서만 실행된다. (npm run test:db)
// 지원자 이메일 사전 등록: 관리자가 이메일로 미리 등록하면, 그 사람이 처음 로그인할 때 지원자로 시작한다.
import crypto from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import app from '../../app.js';
import factories from '../../test/factories.js';
import authService from '../auth/auth.service.js';

const { prisma, createUser, tokenFor, cleanup } = factories;

const DOMAIN = '@invite-test.example';
const GOOGLE_PREFIX = 'invite-test-';

let admin;
let requester;
let supporter;

const call = (method, path, user, body) => {
  const req = request(app)[method](`/api${path}`);
  if (user) req.set('Authorization', `Bearer ${tokenFor(user)}`);
  return body ? req.send(body) : req;
};
const register = (user, emails) => call('post', '/admin/supporters', user, { emails });
const listInvites = (user) => call('get', '/admin/supporter-invites', user);

/** 이 파일 전용 이메일. 소문자 고유 문자열이라 다른 테스트와 겹치지 않는다. */
const newEmail = () => `s${crypto.randomBytes(5).toString('hex')}${DOMAIN}`;
const inviteRows = (email) => prisma.supporterInvite.findMany({ where: { email: email.toLowerCase() } });
const roleOfEmail = async (email) => (await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } }))?.role;

/** Google 로그인 콜백이 하는 일: 프로필로 사용자를 찾거나 만든다. */
const login = (email, { emailVerified = true, googleId = `${GOOGLE_PREFIX}${crypto.randomBytes(6).toString('hex')}` } = {}) =>
  authService.upsertUserFromGoogle({ googleId, email, name: '신규 학생', emailVerified });

async function cleanupLocal() {
  await prisma.supporterInvite.deleteMany({ where: { email: { endsWith: DOMAIN } } });
  await prisma.user.deleteMany({ where: { googleId: { startsWith: GOOGLE_PREFIX } } });
  // 테스트 환경의 관리자 이메일(admin@example.com)로 만든 사용자도 정리한다.
  await prisma.user.deleteMany({ where: { email: 'admin@example.com' } });
  await prisma.supporterInvite.deleteMany({ where: { email: 'admin@example.com' } });
}

beforeAll(async () => {
  const [{ db }] = await prisma.$queryRaw`select current_database() as db`;
  expect(db.endsWith('_test')).toBe(true);
  [admin, requester, supporter] = await Promise.all([createUser('ADMIN'), createUser('REQUESTER'), createUser('SUPPORTER')]);
});

afterEach(cleanupLocal);

afterAll(async () => {
  await cleanupLocal();
  await cleanup();
  await prisma.$disconnect();
});

describe('POST /api/admin/supporters — 등록', () => {
  it('아직 가입하지 않은 이메일은 대기 등록(INVITED)되고 소문자로 저장된다', async () => {
    const email = newEmail();
    const res = await register(admin, [email.toUpperCase()]);

    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([{ email, result: 'INVITED' }]);
    expect(await inviteRows(email)).toHaveLength(1);
    expect(await roleOfEmail(email)).toBeUndefined(); // 사용자는 아직 만들어지지 않는다
  });

  it('이미 가입한 요청자는 바로 지원자가 된다(PROMOTED). 대기 등록은 남지 않는다', async () => {
    const user = await createUser('REQUESTER');
    const res = await register(admin, [user.email]);

    expect(res.body.results).toEqual([{ email: user.email, result: 'PROMOTED' }]);
    expect(await roleOfEmail(user.email)).toBe('SUPPORTER');
    expect(await inviteRows(user.email)).toHaveLength(0);
  });

  it('가입한 사용자의 이메일이 대문자를 섞어 저장돼 있어도 찾아서 바꾼다', async () => {
    const user = await createUser('REQUESTER');
    const mixed = user.email.replace('test-', 'Test-');
    await prisma.user.update({ where: { id: user.id }, data: { email: mixed } });

    const res = await register(admin, [user.email]);

    expect(res.body.results[0].result).toBe('PROMOTED');
    expect(await roleOfEmail(mixed)).toBe('SUPPORTER');
  });

  it('이미 지원자인 사람은 그대로 둔다(ALREADY_SUPPORTER)', async () => {
    const res = await register(admin, [supporter.email]);
    expect(res.body.results).toEqual([{ email: supporter.email, result: 'ALREADY_SUPPORTER' }]);
    expect(await roleOfEmail(supporter.email)).toBe('SUPPORTER');
  });

  it('관리자 계정은 바꾸지 않는다(ADMIN)', async () => {
    const res = await register(admin, [admin.email]);
    expect(res.body.results).toEqual([{ email: admin.email, result: 'ADMIN' }]);
    expect(await roleOfEmail(admin.email)).toBe('ADMIN');
  });

  it('ADMIN_EMAILS에 있는 이메일은 아직 가입 전이어도 지원자로 등록하지 않는다(ADMIN)', async () => {
    const res = await register(admin, ['Admin@Example.com']);
    expect(res.body.results).toEqual([{ email: 'admin@example.com', result: 'ADMIN' }]);
    expect(await inviteRows('admin@example.com')).toHaveLength(0);
  });

  it('같은 이메일을 다시 등록하면 ALREADY_INVITED이고 한 건만 남는다(대소문자 달라도 같은 이메일)', async () => {
    const email = newEmail();
    await register(admin, [email]);
    const again = await register(admin, [email.toUpperCase()]);

    expect(again.body.results).toEqual([{ email, result: 'ALREADY_INVITED' }]);
    expect(await inviteRows(email)).toHaveLength(1);
  });

  it('동시에 같은 이메일을 등록해도 한 건만 만들어진다', async () => {
    const email = newEmail();
    const responses = await Promise.all([register(admin, [email]), register(admin, [email]), register(admin, [email])]);

    const results = responses.map((res) => res.body.results[0].result).sort();
    expect(responses.every((res) => res.status === 200)).toBe(true);
    expect(results).toEqual(['ALREADY_INVITED', 'ALREADY_INVITED', 'INVITED']);
    expect(await inviteRows(email)).toHaveLength(1);
  });

  it('여러 이메일을 한 번에: 이메일마다 결과가 입력 순서대로 나온다', async () => {
    const fresh = newEmail();
    const existing = await createUser('REQUESTER');
    const res = await register(admin, [fresh, existing.email, admin.email, supporter.email]);

    expect(res.body.results).toEqual([
      { email: fresh, result: 'INVITED' },
      { email: existing.email, result: 'PROMOTED' },
      { email: admin.email, result: 'ADMIN' },
      { email: supporter.email, result: 'ALREADY_SUPPORTER' },
    ]);
  });

  it('이미 가입한 사람의 남은 대기 등록은 등록 시 정리된다', async () => {
    const user = await createUser('REQUESTER');
    await prisma.supporterInvite.create({ data: { email: user.email } });

    await register(admin, [user.email]);

    expect(await inviteRows(user.email)).toHaveLength(0);
    expect(await roleOfEmail(user.email)).toBe('SUPPORTER');
  });

  it('형식이 틀린 이메일이 섞여 있으면 400이고 아무것도 등록하지 않는다', async () => {
    const good = newEmail();
    const res = await register(admin, [good, 'not-an-email']);

    expect(res.status).toBe(400);
    expect(await inviteRows(good)).toHaveLength(0);
  });

  it('50개를 넘기면 400', async () => {
    const emails = Array.from({ length: 51 }, (_, i) => `x${i}${DOMAIN}`);
    expect((await register(admin, emails)).status).toBe(400);
  });

  it('권한: 로그인 없이 401, 요청자·지원자는 403 — 등록, 목록, 취소 모두', async () => {
    const email = newEmail();
    const invite = await prisma.supporterInvite.create({ data: { email } });

    expect((await register(null, [email])).status).toBe(401);
    expect((await listInvites(null)).status).toBe(401);
    for (const user of [requester, supporter]) {
      expect((await register(user, [email])).status).toBe(403);
      expect((await listInvites(user)).status).toBe(403);
      expect((await call('delete', `/admin/supporter-invites/${invite.id}`, user)).status).toBe(403);
    }
    expect(await roleOfEmail(email)).toBeUndefined();
    expect(await inviteRows(email)).toHaveLength(1); // 권한 없는 삭제 시도가 통하지 않았다
  });
});

describe('대기 목록·취소', () => {
  it('대기 중인 등록을 최근 등록 순으로 보여 준다(id·이메일·등록 시각만)', async () => {
    const first = newEmail();
    const second = newEmail();
    await prisma.supporterInvite.create({ data: { email: first, createdAt: new Date('2026-11-01T00:00:00Z') } });
    await prisma.supporterInvite.create({ data: { email: second, createdAt: new Date('2026-11-02T00:00:00Z') } });

    const res = await listInvites(admin);

    expect(res.status).toBe(200);
    const mine = res.body.filter((row) => row.email.endsWith(DOMAIN));
    expect(mine.map((row) => row.email)).toEqual([second, first]);
    expect(Object.keys(mine[0]).sort()).toEqual(['createdAt', 'email', 'id']);
  });

  it('취소하면 목록에서 사라지고 204, 없는 것을 다시 취소하면 404', async () => {
    const email = newEmail();
    const invite = await prisma.supporterInvite.create({ data: { email } });

    expect((await call('delete', `/admin/supporter-invites/${invite.id}`, admin)).status).toBe(204);
    expect(await inviteRows(email)).toHaveLength(0);
    expect((await call('delete', `/admin/supporter-invites/${invite.id}`, admin)).status).toBe(404);
  });

  it('취소한 뒤 그 이메일로 처음 로그인하면 요청자로 시작한다', async () => {
    const email = newEmail();
    await register(admin, [email]);
    const [invite] = await inviteRows(email);
    await call('delete', `/admin/supporter-invites/${invite.id}`, admin);

    const user = await login(email);

    expect(user.role).toBe('REQUESTER');
  });
});

describe('첫 로그인 시 지원자로 시작', () => {
  it('[완료 조건] 미리 등록한 이메일로 처음 로그인하면 지원자가 되고 대기 등록은 지워진다', async () => {
    const email = newEmail();
    await register(admin, [email]);

    const user = await login(email);

    expect(user.role).toBe('SUPPORTER');
    expect(await inviteRows(email)).toHaveLength(0);
  });

  it('Google이 대소문자를 섞은 이메일을 줘도 같은 사람으로 본다', async () => {
    const email = newEmail();
    await register(admin, [email]);

    const user = await login(email.replace('s', 'S'));

    expect(user.role).toBe('SUPPORTER');
    expect(await inviteRows(email)).toHaveLength(0);
  });

  it('Google이 이메일 소유를 확인하지 않은 로그인에는 적용하지 않고 등록도 남겨 둔다', async () => {
    const email = newEmail();
    await register(admin, [email]);

    expect((await login(email, { emailVerified: false })).role).toBe('REQUESTER');
    expect(await inviteRows(email)).toHaveLength(1);
  });

  it('등록하지 않은 이메일은 요청자로 시작한다', async () => {
    expect((await login(newEmail())).role).toBe('REQUESTER');
  });

  it('다른 사람의 등록은 쓰이지 않는다', async () => {
    const invited = newEmail();
    await register(admin, [invited]);

    expect((await login(newEmail())).role).toBe('REQUESTER');
    expect(await inviteRows(invited)).toHaveLength(1);
  });

  it('관리자 이메일은 등록이 있어도 관리자로 시작하고, 남은 등록은 지워진다', async () => {
    await prisma.supporterInvite.create({ data: { email: 'admin@example.com' } });

    const user = await login('admin@example.com');

    expect(user.role).toBe('ADMIN');
    expect(await inviteRows('admin@example.com')).toHaveLength(0);
  });

  it('이미 가입한 사람이 다시 로그인해도 역할은 바뀌지 않는다(등록은 처음 가입할 때만 쓰인다)', async () => {
    const email = newEmail();
    const googleId = `${GOOGLE_PREFIX}fixed-${crypto.randomBytes(4).toString('hex')}`;
    await login(email, { googleId }); // 요청자로 가입
    await prisma.supporterInvite.create({ data: { email } }); // 가입 뒤에 남은 등록(정상적으로는 생기지 않는 상태)

    const again = await login(email, { googleId });

    expect(again.role).toBe('REQUESTER');
  });

  it('지원자로 시작한 사람을 관리자가 해제하면, 다시 로그인해도 요청자로 남는다', async () => {
    const email = newEmail();
    const googleId = `${GOOGLE_PREFIX}fixed-${crypto.randomBytes(4).toString('hex')}`;
    await register(admin, [email]);
    const user = await login(email, { googleId });
    expect(user.role).toBe('SUPPORTER');

    const released = await call('patch', `/admin/users/${user.id}/role`, admin, { role: 'REQUESTER' });
    const again = await login(email, { googleId });

    expect(released.status).toBe(200);
    expect(again.role).toBe('REQUESTER');
  });

  it('가입 도중 실패하면 사용자도 대기 등록 삭제도 반영되지 않는다(한 번에 처리)', async () => {
    const email = newEmail();
    await register(admin, [email]);
    const taken = `${GOOGLE_PREFIX}dup-${crypto.randomBytes(4).toString('hex')}`;
    await login(newEmail(), { googleId: taken });

    // 같은 googleId 가 이미 있으면 findUnique 가 기존 사용자를 돌려주므로, 이메일 유일 제약을 일부러 깬다.
    await prisma.user.create({ data: { googleId: `${GOOGLE_PREFIX}other-${crypto.randomBytes(4).toString('hex')}`, email, name: '선점', role: 'REQUESTER' } });
    await expect(login(email)).rejects.toThrow();

    expect(await inviteRows(email)).toHaveLength(1); // 사용자 생성이 실패했으니 등록은 그대로 남는다
  });
});
