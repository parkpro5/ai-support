// vitest 는 ESM 전용이라 테스트 파일만 import 문법을 쓴다. 소스(CommonJS)는 기본 import 후 구조 분해한다.
import express from 'express';
import request from 'supertest';
import { describe, it, expect } from 'vitest';
import authMiddleware from './authMiddleware.js';
import errorHandler from './errorHandler.js';
import roles from './roles.js';
import jwtUtils from '../utils/jwt.js';

const { ROLES, requireRole } = roles;
const { signAppToken } = jwtUtils;

/** 실제 인증 미들웨어와 에러 핸들러를 거치는 최소 앱. DB는 쓰지 않는다. */
function buildApp() {
  const app = express();
  app.get('/admin-only', authMiddleware, requireRole(ROLES.ADMIN), (req, res) => res.json({ ok: true }));
  app.get('/staff', authMiddleware, requireRole(ROLES.SUPPORTER, ROLES.ADMIN), (req, res) =>
    res.json({ ok: true })
  );
  app.use(errorHandler);
  return app;
}

function tokenFor(role) {
  return signAppToken({ id: `user-${role}`, email: `${role}@example.com`, role });
}

function get(app, path, token) {
  const req = request(app).get(path);
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
}

describe('requireRole: 역할별 접근', () => {
  const app = buildApp();

  it('요청자가 관리자 전용 경로를 호출하면 403', async () => {
    const res = await get(app, '/admin-only', tokenFor('REQUESTER'));
    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe('Insufficient permissions');
  });

  it('지원자가 관리자 전용 경로를 호출하면 403', async () => {
    const res = await get(app, '/admin-only', tokenFor('SUPPORTER'));
    expect(res.status).toBe(403);
  });

  it('관리자는 관리자 전용 경로를 호출할 수 있다', async () => {
    const res = await get(app, '/admin-only', tokenFor('ADMIN'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('여러 역할을 허용하면 그 역할만 통과하고 나머지는 403', async () => {
    expect((await get(app, '/staff', tokenFor('SUPPORTER'))).status).toBe(200);
    expect((await get(app, '/staff', tokenFor('ADMIN'))).status).toBe(200);
    expect((await get(app, '/staff', tokenFor('REQUESTER'))).status).toBe(403);
  });

  it('토큰이 없으면 401', async () => {
    const res = await get(app, '/admin-only');
    expect(res.status).toBe(401);
  });

  it('잘못된 토큰이면 401', async () => {
    const res = await get(app, '/admin-only', 'abc.def.ghi');
    expect(res.status).toBe(401);
  });

  it('알 수 없는 역할(예: 예전 값 "admin")은 대소문자까지 구분해 403', async () => {
    const res = await get(app, '/admin-only', tokenFor('admin'));
    expect(res.status).toBe(403);
  });
});

describe('requireRole: 단독 동작', () => {
  function run(middleware, user) {
    return new Promise((resolve) => middleware({ user }, {}, (err) => resolve(err)));
  }

  it('req.user가 없으면 401 오류를 넘긴다', async () => {
    const err = await run(requireRole(ROLES.ADMIN), undefined);
    expect(err.statusCode).toBe(401);
  });

  it('허용된 역할이면 오류 없이 다음으로 넘긴다', async () => {
    const err = await run(requireRole(ROLES.ADMIN), { role: 'ADMIN' });
    expect(err).toBeUndefined();
  });

  it('역할을 하나도 안 주면 만드는 시점에 예외', () => {
    expect(() => requireRole()).toThrow();
  });

  it('알 수 없는 역할 이름을 주면 만드는 시점에 예외', () => {
    expect(() => requireRole('SUPERUSER')).toThrow(/Unknown role/);
  });
});
