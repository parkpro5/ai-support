// DB 테스트: 전용 테스트 DB에서만 실행된다. (npm run test:db)
// 실제 저장소(Supabase Storage)에는 접속하지 않는다. 메모리에 파일을 두는 가짜 저장소를 끼워 검증한다.
// vitest 는 ESM 전용이라 테스트 파일만 import 문법을 쓴다. 소스(CommonJS)는 기본 import 후 구조 분해한다.
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import app from '../../app.js';
import factories from '../../test/factories.js';
import rules from './attachment.rules.js';
import storageService from './storage.service.js';

const { prisma, createUser, createSupportType, createRequest, tokenFor, cleanup } = factories;
const { ALLOWED_TYPES, MAX_FILE_BYTES, MAX_FILES_PER_TARGET } = rules;

let requester;
let otherRequester;
let assignee;
let otherSupporter;
let admin;
let supportType;

// ── 가짜 저장소(메모리) ──────────────────────────────────────
/** @type {Map<string, { size: number, contentType: string|null }>} */
let objects;
let issued; // 업로드 주소를 발급한 경로
let downloads; // 내려받기 주소를 만든 기록
let removed; // 삭제를 요청받은 경로
let removeShouldFail;

const fakeStorage = {
  async createUploadUrl(path) {
    issued.push(path);
    return { url: `https://storage.example.test/upload/${path}?token=t` };
  },
  async getObjectInfo(path) {
    return objects.get(path) ?? null;
  },
  async createDownloadUrl(path, fileName, expiresIn) {
    downloads.push({ path, fileName, expiresIn });
    return { url: `https://storage.example.test/download/${path}?ttl=${expiresIn}` };
  },
  async removeObjects(paths) {
    if (removeShouldFail) throw new Error('storage unavailable');
    for (const path of paths) {
      removed.push(path);
      objects.delete(path);
    }
  },
};

/** 브라우저가 서명 주소로 파일을 올린 것을 흉내낸다. */
const simulateUpload = (path, size, contentType = 'application/octet-stream') => objects.set(path, { size, contentType });

// ── 호출 도우미 ──────────────────────────────────────────────
const call = (method, path, user, body) => {
  const req = request(app)[method](`/api${path}`);
  if (user) req.set('Authorization', `Bearer ${tokenFor(user)}`);
  return body ? req.send(body) : req;
};
const uploadUrl = (id, user, body) => call('post', `/requests/${id}/attachments/upload-url`, user, body);
const register = (id, user, body) => call('post', `/requests/${id}/attachments`, user, body);

/** 업로드 주소 발급 → 업로드 → 등록까지 한 번에. 등록 응답을 돌려준다. */
async function attach(user, requestId, target, { fileName = '자료.pdf', size = 1234 } = {}) {
  const issuedRes = await uploadUrl(requestId, user, { target, fileName, size });
  expect(issuedRes.status, JSON.stringify(issuedRes.body)).toBe(200);
  simulateUpload(issuedRes.body.path, size);
  return register(requestId, user, { target, path: issuedRes.body.path, fileName });
}

const newRequest = (overrides = {}) => createRequest({ requester, supportType, ...overrides });
const rowsOf = (requestId) => prisma.attachment.findMany({ where: { requestId }, orderBy: { createdAt: 'asc' } });
const detailOf = async (id, user) => (await call('get', `/requests/${id}`, user)).body;

beforeAll(async () => {
  // 안전장치: 앱이 실제로 테스트 DB를 쓰고 있는지 한 번 더 확인한다.
  const [{ db }] = await prisma.$queryRaw`select current_database() as db`;
  expect(db.endsWith('_test')).toBe(true);

  [requester, otherRequester, assignee, otherSupporter, admin] = await Promise.all([
    createUser('REQUESTER'),
    createUser('REQUESTER'),
    createUser('SUPPORTER'),
    createUser('SUPPORTER'),
    createUser('ADMIN'),
  ]);
  supportType = await createSupportType();
});

beforeEach(() => {
  objects = new Map();
  issued = [];
  downloads = [];
  removed = [];
  removeShouldFail = false;
  storageService.setStorage(fakeStorage);
});

afterEach(() => {
  // 다음 테스트 파일이 이 가짜를 물려받지 않도록, 파일 맨 끝에서 막는 저장소로 되돌린다(afterAll).
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

// ═════════════════════════════════════════════════════════════
describe('POST /api/requests/:id/attachments/upload-url: 업로드 주소 발급', () => {
  it('요청서 작성자는 제출됨 요청서에 대한 업로드 주소를 받고, 아직 DB에는 아무것도 저장되지 않는다', async () => {
    const target = await newRequest();
    const res = await uploadUrl(target.id, requester, { target: 'request', fileName: '보고서.pdf', size: 5000 });

    expect(res.status).toBe(200);
    expect(res.body.uploadUrl).toMatch(/^https:\/\/storage\.example\.test\/upload\//);
    expect(res.body.path).toMatch(new RegExp(`^${target.id}/[0-9a-f-]{36}\\.pdf$`));
    expect(res.body).toMatchObject({ contentType: 'application/pdf', maxBytes: MAX_FILE_BYTES });
    expect(res.body.headers).toEqual({ 'content-type': 'application/pdf', 'x-upsert': 'false', 'cache-control': 'max-age=3600' });
    expect(issued).toEqual([res.body.path]);
    expect(await rowsOf(target.id)).toHaveLength(0);
  });

  it.each(Object.keys(ALLOWED_TYPES))('.%s 파일은 허용되고 확장자에 맞는 형식이 정해진다', async (ext) => {
    const target = await newRequest();
    const res = await uploadUrl(target.id, requester, { target: 'request', fileName: `자료.${ext.toUpperCase()}`, size: 100 });
    expect(res.status).toBe(200);
    expect(res.body.contentType).toBe(ALLOWED_TYPES[ext]);
    expect(res.body.path.endsWith(`.${ext}`)).toBe(true);
  });

  it.each(['run.exe', 'page.html', 'icon.svg', 'macro.js', 'archive.zip', 'noextension', 'invoice.pdf.exe'])(
    '허용되지 않는 형식(%s)은 400이고 주소를 발급하지 않는다',
    async (fileName) => {
      const target = await newRequest();
      const res = await uploadUrl(target.id, requester, { target: 'request', fileName, size: 100 });

      expect(res.status).toBe(400);
      expect(res.body.error.details).toHaveProperty('fileName');
      expect(issued).toEqual([]);
    }
  );

  it.each([
    ['빈 파일', 0],
    ['음수', -5],
    ['10MB 초과', MAX_FILE_BYTES + 1],
    ['소수', 1.5],
  ])('크기 규칙 위반(%s)은 400이고 주소를 발급하지 않는다', async (_name, size) => {
    const target = await newRequest();
    const res = await uploadUrl(target.id, requester, { target: 'request', fileName: 'a.pdf', size });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toHaveProperty('size');
    expect(issued).toEqual([]);
  });

  it('정확히 10MB는 허용된다', async () => {
    const target = await newRequest();
    const res = await uploadUrl(target.id, requester, { target: 'request', fileName: 'big.pdf', size: MAX_FILE_BYTES });
    expect(res.status).toBe(200);
  });

  it('크기가 숫자가 아니거나 대상이 잘못되면 400', async () => {
    const target = await newRequest();
    expect((await uploadUrl(target.id, requester, { target: 'request', fileName: 'a.pdf', size: '100' })).status).toBe(400);
    expect((await uploadUrl(target.id, requester, { target: 'nothing', fileName: 'a.pdf', size: 100 })).status).toBe(400);
    expect((await uploadUrl(target.id, requester, { fileName: 'a.pdf', size: 100 })).status).toBe(400);
  });

  it('저장소 경로에는 사용자가 보낸 이름이 들어가지 않는다(경로 조작 방지)', async () => {
    const target = await newRequest();
    const res = await uploadUrl(target.id, requester, { target: 'request', fileName: '../../etc/passwd.pdf', size: 100 });

    expect(res.status).toBe(200);
    expect(res.body.path).not.toContain('passwd');
    expect(res.body.path).not.toContain('..');
  });

  it('요청서 작성자가 아니면 403: 다른 요청자, 지원자, 관리자', async () => {
    const target = await newRequest();
    for (const user of [otherRequester, assignee, admin]) {
      const res = await uploadUrl(target.id, user, { target: 'request', fileName: 'a.pdf', size: 100 });
      expect(res.status, user.role).toBe(403);
    }
    expect(issued).toEqual([]);
  });

  it('제출됨이 아닌 요청서에는 작성자도 올릴 수 없다(409)', async () => {
    for (const status of ['ACCEPTED', 'FIRST_REVIEW', 'FINAL_REVIEW', 'REWORK', 'COMPLETED']) {
      const target = await newRequest({ status, assignee });
      const res = await uploadUrl(target.id, requester, { target: 'request', fileName: 'a.pdf', size: 100 });
      expect(res.status, status).toBe(409);
    }
  });

  it('작업내역 첨부는 담당 지원자가 접수됨·재작업 상태에서만 올릴 수 있다', async () => {
    for (const status of ['ACCEPTED', 'REWORK']) {
      const target = await newRequest({ status, assignee });
      const res = await uploadUrl(target.id, assignee, { target: 'work', fileName: 'a.pdf', size: 100 });
      expect(res.status, status).toBe(200);
    }
    for (const status of ['FIRST_REVIEW', 'FINAL_REVIEW', 'COMPLETED']) {
      const target = await newRequest({ status, assignee });
      expect((await uploadUrl(target.id, assignee, { target: 'work', fileName: 'a.pdf', size: 100 })).status, status).toBe(409);
    }
  });

  it('작업내역 첨부는 담당이 아닌 사람이 올릴 수 없다(403): 다른 지원자, 작성자, 관리자', async () => {
    const target = await newRequest({ status: 'ACCEPTED', assignee });
    for (const user of [otherSupporter, requester, admin]) {
      expect((await uploadUrl(target.id, user, { target: 'work', fileName: 'a.pdf', size: 100 })).status, user.role).toBe(403);
    }
  });

  it('담당 지원자라도 요청서 첨부(target=request)는 올릴 수 없다', async () => {
    const target = await newRequest({ status: 'ACCEPTED', assignee });
    expect((await uploadUrl(target.id, assignee, { target: 'request', fileName: 'a.pdf', size: 100 })).status).toBe(403);
  });

  it('로그인하지 않으면 401, 없는 요청서는 404', async () => {
    const target = await newRequest();
    expect((await uploadUrl(target.id, null, { target: 'request', fileName: 'a.pdf', size: 100 })).status).toBe(401);
    expect((await uploadUrl('does-not-exist', requester, { target: 'request', fileName: 'a.pdf', size: 100 })).status).toBe(404);
  });

  it(`이미 ${MAX_FILES_PER_TARGET}개를 올렸다면 더 올릴 수 없다(409)`, async () => {
    const target = await newRequest();
    for (let i = 0; i < MAX_FILES_PER_TARGET; i += 1) {
      expect((await attach(requester, target.id, 'request', { fileName: `f${i}.pdf` })).status).toBe(201);
    }
    const res = await uploadUrl(target.id, requester, { target: 'request', fileName: 'one-more.pdf', size: 100 });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain(String(MAX_FILES_PER_TARGET));
  });
});

// ═════════════════════════════════════════════════════════════
describe('POST /api/requests/:id/attachments: 업로드한 파일 등록', () => {
  it('업로드한 파일을 등록하면 201이고 실제 크기·표준 형식·올린 사람이 기록된다', async () => {
    const target = await newRequest();
    const res = await attach(requester, target.id, 'request', { fileName: '보고서.PDF', size: 4321 });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      fileName: '보고서.PDF',
      size: 4321,
      mime: 'application/pdf',
      kind: 'request',
      workLogId: null,
      uploader: { id: requester.id },
    });
    // 응답에 저장소 경로가 나가지 않는다.
    expect(res.body).not.toHaveProperty('storagePath');
    expect(JSON.stringify(res.body)).not.toContain(target.id);

    const rows = await rowsOf(target.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ uploaderId: requester.id, size: 4321, mime: 'application/pdf', workLogId: null });
  });

  it('클라이언트가 말한 크기가 아니라 저장소의 실제 크기를 저장한다', async () => {
    const target = await newRequest();
    const issuedRes = await uploadUrl(target.id, requester, { target: 'request', fileName: 'a.pdf', size: 100 });
    simulateUpload(issuedRes.body.path, 7777); // 100이라고 하고 실제로는 7777바이트를 올림

    const res = await register(target.id, requester, { target: 'request', path: issuedRes.body.path, fileName: 'a.pdf' });
    expect(res.status).toBe(201);
    expect(res.body.size).toBe(7777);
  });

  it('형식은 클라이언트가 보낸 값이 아니라 확장자로 정한 값을 저장한다', async () => {
    const target = await newRequest();
    const issuedRes = await uploadUrl(target.id, requester, { target: 'request', fileName: 'a.hwp', size: 100 });
    simulateUpload(issuedRes.body.path, 100, 'text/html'); // 저장소에는 엉뚱한 형식으로 올라옴

    const res = await register(target.id, requester, { target: 'request', path: issuedRes.body.path, fileName: 'a.hwp' });
    expect(res.body.mime).toBe('application/x-hwp');
  });

  it('파일 이름은 다듬어서 저장한다(경로·제어문자 제거, 길이 제한)', async () => {
    const target = await newRequest();
    const res = await attach(requester, target.id, 'request', { fileName: '../../etc/passwd.pdf' });
    expect(res.body.fileName).toBe('passwd.pdf');

    const long = `${'가'.repeat(200)}.pdf`; // 150자 초과, 요청 상한(255자) 이하
    const res2 = await attach(requester, target.id, 'request', { fileName: long });
    expect(res2.status).toBe(201);
    expect(res2.body.fileName.length).toBeLessThanOrEqual(150);
    expect(res2.body.fileName.endsWith('.pdf')).toBe(true);
  });

  it('실제로 올라오지 않은 파일은 등록할 수 없다(400)', async () => {
    const target = await newRequest();
    const issuedRes = await uploadUrl(target.id, requester, { target: 'request', fileName: 'a.pdf', size: 100 });
    // 업로드하지 않음
    const res = await register(target.id, requester, { target: 'request', path: issuedRes.body.path, fileName: 'a.pdf' });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toHaveProperty('path');
    expect(await rowsOf(target.id)).toHaveLength(0);
  });

  it.each([
    ['10MB 초과', MAX_FILE_BYTES + 1],
    ['빈 파일', 0],
  ])('저장소에 실제로 올라온 파일이 규칙을 어기면(%s) 등록을 거부하고 저장소에서도 지운다', async (_name, actualSize) => {
    const target = await newRequest();
    const issuedRes = await uploadUrl(target.id, requester, { target: 'request', fileName: 'a.pdf', size: 100 });
    simulateUpload(issuedRes.body.path, actualSize); // 말한 것과 다른 실제 크기

    const res = await register(target.id, requester, { target: 'request', path: issuedRes.body.path, fileName: 'a.pdf' });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toHaveProperty('size');
    expect(await rowsOf(target.id)).toHaveLength(0);
    expect(removed).toEqual([issuedRes.body.path]);
    expect(objects.has(issuedRes.body.path)).toBe(false);
  });

  it('다른 요청서용 경로는 등록할 수 없다(400)', async () => {
    const mine = await newRequest();
    const theirs = await newRequest({ requester: otherRequester });
    const issuedRes = await uploadUrl(theirs.id, otherRequester, { target: 'request', fileName: 'a.pdf', size: 100 });
    simulateUpload(issuedRes.body.path, 100);

    const res = await register(mine.id, requester, { target: 'request', path: issuedRes.body.path, fileName: 'a.pdf' });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toHaveProperty('path');
    expect(await rowsOf(mine.id)).toHaveLength(0);
  });

  it.each([
    ['경로 이동', (id) => `${id}/../other/x.pdf`],
    ['uuid가 아닌 이름', (id) => `${id}/report.pdf`],
    ['허용되지 않는 확장자', (id) => `${id}/0b8e3f10-9a3c-4c52-8d41-2f7f3b6a9e11.exe`],
    ['하위 폴더', (id) => `${id}/sub/0b8e3f10-9a3c-4c52-8d41-2f7f3b6a9e11.pdf`],
  ])('형식이 어긋난 경로(%s)는 400이고 저장소를 조회하지도 않는다', async (_name, makePath) => {
    const target = await newRequest();
    const path = makePath(target.id);
    simulateUpload(path, 100); // 설령 그 경로에 파일이 있어도
    const res = await register(target.id, requester, { target: 'request', path, fileName: 'a.pdf' });

    expect(res.status).toBe(400);
    expect(await rowsOf(target.id)).toHaveLength(0);
  });

  it('파일 이름의 확장자가 올린 파일과 다르면 400(이름만 바꿔 속이는 것을 막는다)', async () => {
    const target = await newRequest();
    const issuedRes = await uploadUrl(target.id, requester, { target: 'request', fileName: 'a.pdf', size: 100 });
    simulateUpload(issuedRes.body.path, 100);

    const res = await register(target.id, requester, { target: 'request', path: issuedRes.body.path, fileName: 'a.png' });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toHaveProperty('fileName');
  });

  it('같은 파일을 두 번 등록할 수 없다(409)', async () => {
    const target = await newRequest();
    const issuedRes = await uploadUrl(target.id, requester, { target: 'request', fileName: 'a.pdf', size: 100 });
    simulateUpload(issuedRes.body.path, 100);
    const body = { target: 'request', path: issuedRes.body.path, fileName: 'a.pdf' };

    expect((await register(target.id, requester, body)).status).toBe(201);
    expect((await register(target.id, requester, body)).status).toBe(409);
    expect(await rowsOf(target.id)).toHaveLength(1);
  });

  it('같은 파일을 동시에 여러 번 등록해도 한 번만 저장된다', async () => {
    const target = await newRequest();
    const issuedRes = await uploadUrl(target.id, requester, { target: 'request', fileName: 'a.pdf', size: 100 });
    simulateUpload(issuedRes.body.path, 100);
    const body = { target: 'request', path: issuedRes.body.path, fileName: 'a.pdf' };

    const results = await Promise.all([1, 2, 3].map(() => register(target.id, requester, body)));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect(await rowsOf(target.id)).toHaveLength(1);
  });

  it('권한과 상태 규칙은 업로드 주소 발급과 같다: 작성자 아님 403, 제출됨 아님 409, 비로그인 401', async () => {
    const target = await newRequest();
    const issuedRes = await uploadUrl(target.id, requester, { target: 'request', fileName: 'a.pdf', size: 100 });
    simulateUpload(issuedRes.body.path, 100);
    const body = { target: 'request', path: issuedRes.body.path, fileName: 'a.pdf' };

    expect((await register(target.id, otherRequester, body)).status).toBe(403);
    expect((await register(target.id, assignee, body)).status).toBe(403);
    expect((await register(target.id, null, body)).status).toBe(401);

    await prisma.request.update({ where: { id: target.id }, data: { status: 'ACCEPTED', assigneeId: assignee.id } });
    expect((await register(target.id, requester, body)).status).toBe(409);
    expect(await rowsOf(target.id)).toHaveLength(0);
  });

  it('경로가 없거나 형식이 이상한 본문은 400', async () => {
    const target = await newRequest();
    expect((await register(target.id, requester, { target: 'request', fileName: 'a.pdf' })).status).toBe(400);
    expect((await register(target.id, requester, { target: 'request', path: 123, fileName: 'a.pdf' })).status).toBe(400);
  });
});

// ═════════════════════════════════════════════════════════════
describe('요청서 상세의 첨부 목록과 내려받기', () => {
  it('작성자·담당 지원자·관리자는 요청서 첨부를 목록에서 보고 내려받을 수 있다', async () => {
    const target = await newRequest();
    const created = await attach(requester, target.id, 'request', { fileName: '요청자료.pdf', size: 999 });
    await prisma.request.update({ where: { id: target.id }, data: { status: 'ACCEPTED', assigneeId: assignee.id } });

    for (const viewer of [requester, assignee, admin]) {
      const detail = await detailOf(target.id, viewer);
      expect(detail.attachments.map((a) => [a.id, a.fileName, a.size, a.kind]), viewer.role).toEqual([
        [created.body.id, '요청자료.pdf', 999, 'request'],
      ]);

      const res = await call('get', `/attachments/${created.body.id}/download-url`, viewer);
      expect(res.status, viewer.role).toBe(200);
      expect(res.body).toMatchObject({ fileName: '요청자료.pdf', expiresIn: 60 });
      expect(res.body.url).toContain('storage.example.test/download/');
    }
  });

  it('내려받기 주소는 60초만 유효하고 원래 파일 이름으로 저장되게 만든다', async () => {
    const target = await newRequest();
    const created = await attach(requester, target.id, 'request', { fileName: '한글 이름 (최종).pdf' });
    await call('get', `/attachments/${created.body.id}/download-url`, requester);

    expect(downloads).toHaveLength(1);
    expect(downloads[0]).toMatchObject({ fileName: '한글 이름 (최종).pdf', expiresIn: 60 });
    const row = (await rowsOf(target.id))[0];
    expect(downloads[0].path).toBe(row.storagePath);
  });

  it('권한이 없는 사용자는 내려받을 수 없다(403): 다른 요청자, 요청서와 무관한 지원자', async () => {
    const target = await newRequest();
    const created = await attach(requester, target.id, 'request');

    for (const user of [otherRequester, otherSupporter, assignee]) {
      // 담당 지원자도 접수 전(담당자 지정 전)에는 요청서에 관여하지 않으므로 볼 수 없다.
      const res = await call('get', `/attachments/${created.body.id}/download-url`, user);
      expect(res.status, user.role).toBe(403);
    }
    expect(downloads).toEqual([]);
  });

  it('권한이 없는 사용자의 상세 응답에는 첨부 목록이 비어 있다', async () => {
    const target = await newRequest();
    await attach(requester, target.id, 'request');

    // 접수 가능 목록을 둘러보는 다른 지원자는 제출됨 요청서의 상세는 볼 수 있지만 첨부는 보이지 않는다.
    const detail = await detailOf(target.id, otherSupporter);
    expect(detail.attachments).toEqual([]);
  });

  it('로그인하지 않으면 401, 없는 첨부는 404', async () => {
    const target = await newRequest();
    const created = await attach(requester, target.id, 'request');
    expect((await call('get', `/attachments/${created.body.id}/download-url`)).status).toBe(401);
    expect((await call('get', '/attachments/does-not-exist/download-url', requester)).status).toBe(404);
  });

  it('상세 응답에 저장소 경로가 새어 나가지 않는다', async () => {
    const target = await newRequest();
    await attach(requester, target.id, 'request');
    const detail = await call('get', `/requests/${target.id}`, requester);
    const row = (await rowsOf(target.id))[0];

    expect(JSON.stringify(detail.body)).not.toContain(row.storagePath);
    expect(Object.keys(detail.body.attachments[0]).sort()).toEqual(['createdAt', 'fileName', 'id', 'kind', 'mime', 'size', 'uploader', 'workLogId']);
  });
});

// ═════════════════════════════════════════════════════════════
describe('작업내역 첨부: 제출 전 임시 → 제출 시 작업내역에 묶임', () => {
  it('제출 전에 올린 파일은 올린 지원자에게만 보이고, 작성자·관리자에게는 보이지 않는다', async () => {
    const target = await newRequest({ status: 'ACCEPTED', assignee });
    const created = await attach(assignee, target.id, 'work', { fileName: '결과물.xlsx' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ kind: 'pendingWork', workLogId: null });

    expect((await detailOf(target.id, assignee)).attachments.map((a) => a.id)).toEqual([created.body.id]);
    expect((await detailOf(target.id, requester)).attachments).toEqual([]);
    expect((await detailOf(target.id, admin)).attachments).toEqual([]);

    // 내려받기도 올린 본인만 된다.
    expect((await call('get', `/attachments/${created.body.id}/download-url`, assignee)).status).toBe(200);
    expect((await call('get', `/attachments/${created.body.id}/download-url`, requester)).status).toBe(403);
    expect((await call('get', `/attachments/${created.body.id}/download-url`, admin)).status).toBe(403);
  });

  it('작업내역을 제출하면 올려 둔 파일이 그 작업내역에 묶이고 작성자·관리자에게도 보인다', async () => {
    const target = await newRequest({ status: 'ACCEPTED', assignee });
    const a = await attach(assignee, target.id, 'work', { fileName: '결과1.pdf' });
    const b = await attach(assignee, target.id, 'work', { fileName: '결과2.png' });

    const submitted = await call('post', `/requests/${target.id}/work-logs`, assignee, { content: '작업함', minutes: 30 });
    expect(submitted.status).toBe(201);
    const logId = submitted.body.workLogs[0].id;

    const rows = await rowsOf(target.id);
    expect(rows.map((r) => r.workLogId)).toEqual([logId, logId]);

    for (const viewer of [requester, assignee, admin]) {
      const detail = await detailOf(target.id, viewer);
      expect(detail.attachments.map((x) => [x.id, x.kind, x.workLogId]), viewer.role).toEqual([
        [a.body.id, 'work', logId],
        [b.body.id, 'work', logId],
      ]);
      expect((await call('get', `/attachments/${a.body.id}/download-url`, viewer)).status, viewer.role).toBe(200);
    }
  });

  it('제출은 작업내역 첨부만 묶고 작성자의 요청서 첨부는 건드리지 않는다', async () => {
    const target = await newRequest();
    const fromRequester = await attach(requester, target.id, 'request', { fileName: '요청자료.pdf' });
    await call('post', `/requests/${target.id}/accept`, assignee);
    await attach(assignee, target.id, 'work', { fileName: '결과.pdf' });
    await call('post', `/requests/${target.id}/work-logs`, assignee, { content: '작업', minutes: 1 });

    const rows = await rowsOf(target.id);
    const requesterRow = rows.find((r) => r.id === fromRequester.body.id);
    expect(requesterRow.workLogId).toBeNull();
    expect(rows.filter((r) => r.workLogId !== null)).toHaveLength(1);
  });

  it('재작업 후 재제출하면 새로 올린 파일은 새 회차에 묶이고 이전 회차 파일은 그대로다', async () => {
    const target = await newRequest({ status: 'ACCEPTED', assignee });
    const first = await attach(assignee, target.id, 'work', { fileName: '1회차.pdf' });
    const firstSubmit = await call('post', `/requests/${target.id}/work-logs`, assignee, { content: '1', minutes: 1 });
    await call('post', `/requests/${target.id}/first-review`, requester, { decision: 'REJECT', reason: '보완' });

    const second = await attach(assignee, target.id, 'work', { fileName: '2회차.pdf' });
    const secondSubmit = await call('post', `/requests/${target.id}/work-logs`, assignee, { content: '2', minutes: 1 });
    expect(secondSubmit.status).toBe(201);

    const detail = await detailOf(target.id, requester);
    const byId = Object.fromEntries(detail.attachments.map((a) => [a.id, a.workLogId]));
    expect(byId[first.body.id]).toBe(firstSubmit.body.workLogs[0].id);
    expect(byId[second.body.id]).toBe(secondSubmit.body.workLogs[1].id);
    expect(byId[first.body.id]).not.toBe(byId[second.body.id]);
  });

  it('파일 없이 제출해도 정상이다(첨부는 선택)', async () => {
    const target = await newRequest({ status: 'ACCEPTED', assignee });
    const res = await call('post', `/requests/${target.id}/work-logs`, assignee, { content: '작업', minutes: 1 });
    expect(res.status).toBe(201);
    expect(res.body.attachments).toEqual([]);
  });

  it(`작업내역 첨부도 ${MAX_FILES_PER_TARGET}개까지다(409)`, async () => {
    const target = await newRequest({ status: 'ACCEPTED', assignee });
    for (let i = 0; i < MAX_FILES_PER_TARGET; i += 1) {
      expect((await attach(assignee, target.id, 'work', { fileName: `r${i}.pdf` })).status).toBe(201);
    }
    expect((await uploadUrl(target.id, assignee, { target: 'work', fileName: 'x.pdf', size: 10 })).status).toBe(409);
  });
});

// ═════════════════════════════════════════════════════════════
describe('DELETE /api/attachments/:id', () => {
  it('올린 작성자가 제출됨 상태에서 지우면 204이고 DB 기록과 저장소 파일이 모두 사라진다', async () => {
    const target = await newRequest();
    const created = await attach(requester, target.id, 'request');
    const row = (await rowsOf(target.id))[0];

    const res = await call('delete', `/attachments/${created.body.id}`, requester);
    expect(res.status).toBe(204);
    expect(await rowsOf(target.id)).toHaveLength(0);
    expect(removed).toEqual([row.storagePath]);
  });

  it('올린 사람이 아니면 지울 수 없다(403): 다른 요청자, 관리자, 지원자', async () => {
    const target = await newRequest();
    const created = await attach(requester, target.id, 'request');
    for (const user of [otherRequester, admin, assignee, otherSupporter]) {
      expect((await call('delete', `/attachments/${created.body.id}`, user)).status, user.role).toBe(403);
    }
    expect(await rowsOf(target.id)).toHaveLength(1);
    expect(removed).toEqual([]);
  });

  it('요청서가 접수된 뒤에는 작성자도 요청서 첨부를 지울 수 없다(409)', async () => {
    const target = await newRequest();
    const created = await attach(requester, target.id, 'request');
    await prisma.request.update({ where: { id: target.id }, data: { status: 'ACCEPTED', assigneeId: assignee.id } });

    expect((await call('delete', `/attachments/${created.body.id}`, requester)).status).toBe(409);
    expect(await rowsOf(target.id)).toHaveLength(1);
  });

  it('제출 전 임시 작업내역 첨부는 올린 지원자가 지울 수 있고, 제출된 뒤에는 지울 수 없다(409)', async () => {
    const target = await newRequest({ status: 'ACCEPTED', assignee });
    const pending = await attach(assignee, target.id, 'work', { fileName: 'a.pdf' });
    expect((await call('delete', `/attachments/${pending.body.id}`, assignee)).status).toBe(204);

    const kept = await attach(assignee, target.id, 'work', { fileName: 'b.pdf' });
    await call('post', `/requests/${target.id}/work-logs`, assignee, { content: '작업', minutes: 1 });
    expect((await call('delete', `/attachments/${kept.body.id}`, assignee)).status).toBe(409);
    expect(await rowsOf(target.id)).toHaveLength(1);
  });

  it('저장소 삭제가 실패해도 삭제 요청은 성공한다(DB 기록은 지워진다)', async () => {
    const target = await newRequest();
    const created = await attach(requester, target.id, 'request');
    removeShouldFail = true;

    expect((await call('delete', `/attachments/${created.body.id}`, requester)).status).toBe(204);
    expect(await rowsOf(target.id)).toHaveLength(0);
  });

  it('없는 첨부는 404, 로그인하지 않으면 401', async () => {
    expect((await call('delete', '/attachments/does-not-exist', requester)).status).toBe(404);
    const target = await newRequest();
    const created = await attach(requester, target.id, 'request');
    expect((await call('delete', `/attachments/${created.body.id}`)).status).toBe(401);
  });

  it('같은 첨부를 동시에 여러 번 지워도 한 번만 성공한다', async () => {
    const target = await newRequest();
    const created = await attach(requester, target.id, 'request');
    const results = await Promise.all([1, 2, 3].map(() => call('delete', `/attachments/${created.body.id}`, requester)));

    expect(results.filter((r) => r.status === 204)).toHaveLength(1);
    expect(results.filter((r) => r.status !== 204).every((r) => [404, 409].includes(r.status))).toBe(true);
    expect(await rowsOf(target.id)).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════
describe('요청서 삭제와 첨부 정리', () => {
  it('요청서를 삭제하면 기록은 함께 지워지고 저장소의 파일도 정리된다', async () => {
    const target = await newRequest();
    await attach(requester, target.id, 'request', { fileName: 'a.pdf' });
    await attach(requester, target.id, 'request', { fileName: 'b.png' });
    const paths = (await rowsOf(target.id)).map((r) => r.storagePath).sort();

    const res = await call('delete', `/requests/${target.id}`, requester);
    expect(res.status).toBe(204);
    expect(await rowsOf(target.id)).toHaveLength(0);
    expect([...removed].sort()).toEqual(paths);
  });

  it('저장소 정리가 실패해도 요청서 삭제는 성공한다', async () => {
    const target = await newRequest();
    await attach(requester, target.id, 'request');
    removeShouldFail = true;

    expect((await call('delete', `/requests/${target.id}`, requester)).status).toBe(204);
    expect(await prisma.request.findUnique({ where: { id: target.id } })).toBeNull();
  });

  it('첨부가 없는 요청서를 지울 때는 저장소를 건드리지 않는다', async () => {
    const target = await newRequest();
    expect((await call('delete', `/requests/${target.id}`, requester)).status).toBe(204);
    expect(removed).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════
describe('저장소가 설정되지 않았을 때', () => {
  it('첨부 기능만 503으로 막히고 요청서 처리는 정상이다', async () => {
    storageService.resetStorage(); // 테스트 환경에는 저장소 설정이 비어 있다
    const target = await newRequest();

    const res = await uploadUrl(target.id, requester, { target: 'request', fileName: 'a.pdf', size: 100 });
    expect(res.status).toBe(503);
    expect(res.body.error.message).toContain('저장소');

    // 첨부와 무관한 처리는 영향이 없다.
    const edit = await call('patch', `/requests/${target.id}`, requester, { title: '수정됨' });
    expect(edit.status).toBe(200);
  });

  it('설정이 없어도 요청서 상세와 목록은 정상이다', async () => {
    storageService.resetStorage();
    const target = await newRequest();
    expect((await call('get', `/requests/${target.id}`, requester)).status).toBe(200);
    expect((await call('get', '/requests', requester)).status).toBe(200);
  });
});
