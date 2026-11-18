// DB 테스트: 전용 테스트 DB에서만 실행된다. (npm run test:db)
// 헬스체크: 로그인 없이 부를 수 있고, DB에 실제로 질의하며, 실패하면 내부 정보 없이 503.
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import app from '../../app.js';
import factories from '../../test/factories.js';

const { prisma } = factories;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/health', () => {
  it('로그인 없이 200과 상태를 돌려준다', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: 'ok' });
  });

  it('캐시되지 않는다(스케줄러가 매번 DB까지 확인하도록)', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('DB에 실제로 질의한다(앱 서버만 확인하는 것이 아니다)', async () => {
    const spy = vi.spyOn(prisma, '$queryRaw');

    await request(app).get('/api/health');

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('DB 질의가 실패하면 503이고, 오류 내용·접속 정보를 내보내지 않는다', async () => {
    vi.spyOn(prisma, '$queryRaw').mockRejectedValue(
      new Error("Can't reach database server at db.secret-project.supabase.co:5432 password=hunter2"),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'error', db: 'down' });
    expect(JSON.stringify(res.body)).not.toMatch(/secret|hunter2|supabase|5432/);
  });

  it('실패했다가 DB가 돌아오면 다시 200이 된다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const spy = vi.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error('down'));

    expect((await request(app).get('/api/health')).status).toBe(503);
    spy.mockRestore();
    expect((await request(app).get('/api/health')).status).toBe(200);
  });

  it('다른 경로(/api/health/x)는 404', async () => {
    expect((await request(app).get('/api/health/x')).status).toBe(404);
  });
});
