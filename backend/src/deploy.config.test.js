// 배포 설정 점검: Vercel 라우팅, 환경변수 문서가 코드와 어긋나지 않는지 확인한다. (DB·네트워크 불필요)
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const read = (relative) => readFileSync(resolve(root, relative), 'utf8');

const vercel = JSON.parse(read('vercel.json'));

/** Vercel의 rewrite 규칙을 위에서부터 적용해, 이 경로가 어디로 가는지 알려준다. */
function route(pathname) {
  for (const rule of vercel.rewrites) {
    if (new RegExp(`^${rule.source}$`).test(pathname)) return rule.destination;
  }
  return null;
}

describe('vercel.json', () => {
  it('/api/* 는 서버리스 함수(api/index.js)로, 그 밖의 주소는 SPA(index.html)로 간다', () => {
    expect(route('/api/health')).toBe('/api/index.js');
    expect(route('/api/auth/google/callback')).toBe('/api/index.js');
    expect(route('/api/requests/abc/rating')).toBe('/api/index.js');
    expect(route('/requests/abc')).toBe('/index.html');
    expect(route('/dashboard')).toBe('/index.html');
    expect(route('/')).toBe('/index.html');
  });

  it('/api/* 규칙이 SPA 규칙보다 앞에 있다', () => {
    expect(vercel.rewrites[0].source).toMatch(/\/api\//);
  });

  it('빌드 결과 폴더와 함수 진입점이 실제로 있는 경로를 가리킨다', () => {
    expect(vercel.outputDirectory).toBe('frontend/dist');
    expect(vercel.buildCommand).toContain('frontend');
    expect(existsSync(resolve(root, 'api/index.js'))).toBe(true);
    expect(read('api/index.js')).toContain('backend/src/app');
  });

  it('Vercel 자체 Cron 은 쓰지 않는다(외부 스케줄러 사용)', () => {
    expect(vercel.crons).toBeUndefined();
  });
});

describe('환경변수 문서', () => {
  const envSource = read('backend/src/config/env.js');
  const exampleSource = read('.env.example');
  const readme = read('README.md');

  // env.js 의 zod 스키마에서 변수 이름을 뽑는다.
  const names = [...envSource.matchAll(/^\s{2}([A-Z][A-Z0-9_]+): z\./gm)].map((match) => match[1]);

  it('스키마에서 변수 이름을 읽어 왔다(이 테스트 자체의 점검)', () => {
    expect(names).toEqual(expect.arrayContaining(['DATABASE_URL', 'JWT_SECRET', 'CRON_SECRET', 'SUPABASE_BUCKET']));
    expect(names.length).toBeGreaterThanOrEqual(15);
  });

  // NODE_ENV 는 호스트(Vercel·npm)가 정해 주는 값이라 예시 파일에 두지 않는다.
  it.each(names.filter((name) => name !== 'NODE_ENV'))('%s 는 .env.example 에 있다', (name) => {
    expect(exampleSource).toMatch(new RegExp(`^${name}=`, 'm'));
  });

  it.each(names)('%s 는 README 의 배포 환경변수 표에 있다', (name) => {
    // 표의 한 줄("| `이름` | …")로 있어야 한다. 글 어딘가에 이름만 언급된 것으로는 부족하다.
    expect(readme).toContain(`\n| \`${name}\` |`);
  });

  it.each(['DIRECT_URL', 'VITE_VAPID_PUBLIC_KEY'])('%s(스키마 밖에서 쓰는 값)도 README 에 있다', (name) => {
    expect(readme).toContain(`\`${name}\``);
  });

  it('.env.example 에 실제 비밀로 보이는 값이 들어 있지 않다', () => {
    expect(exampleSource).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/); // JWT/서비스 키 모양
    expect(exampleSource).not.toMatch(/GOCSPX-/); // Google 클라이언트 비밀 모양
  });
});
