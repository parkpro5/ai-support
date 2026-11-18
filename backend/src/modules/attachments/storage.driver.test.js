// 운영용 저장소 드라이버(createSupabaseStorage)의 실제 HTTP 호출 코드를 로컬 가짜 Supabase Storage 서버로 실행해 본다.
// (공식 클라이언트 @supabase/storage-js 를 그대로 쓰므로 요청·응답 모양은 그 클라이언트가 정한 것이다.)
// vitest 는 ESM 전용이라 테스트 파일만 import 문법을 쓴다. 소스(CommonJS)는 기본 import 후 구조 분해한다.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import storage from './storage.service.js';
import fake from '../../test/fakeSupabaseStorage.js';

const { createSupabaseStorage } = storage;
const { startFakeSupabaseStorage } = fake;

const BUCKET = 'attachments';
const SERVICE_KEY = 'local-test-key';

let server;
let driver;

/** 브라우저가 하는 것처럼, 발급받은 주소로 파일을 올린다. */
async function putFile(uploadUrl, body, headers) {
  return fetch(uploadUrl, { method: 'PUT', headers, body });
}

const uploadHeaders = { 'content-type': 'application/pdf', 'x-upsert': 'false', 'cache-control': 'max-age=3600' };

beforeAll(async () => {
  server = await startFakeSupabaseStorage({ bucket: BUCKET, serviceKey: SERVICE_KEY, maxBytes: 1000 });
  driver = createSupabaseStorage({
    SUPABASE_URL: server.url,
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
    SUPABASE_BUCKET: BUCKET,
  });
});

afterAll(async () => {
  await server.close();
});

describe('운영용 저장소 드라이버 (가짜 Supabase Storage 서버로 실행)', () => {
  it('업로드 주소를 받아 파일을 올리면 서버가 실제 크기와 형식을 알려 준다', async () => {
    const path = 'req-1/aaaa.pdf';
    const { url } = await driver.createUploadUrl(path);
    expect(url).toContain(`/object/upload/sign/${BUCKET}/${path}`);
    expect(url).toContain('token=');

    const res = await putFile(url, Buffer.alloc(321, 1), uploadHeaders);
    expect(res.status).toBe(200);

    expect(await driver.getObjectInfo(path)).toEqual({ size: 321, contentType: 'application/pdf' });
  });

  it('올라오지 않은 파일의 정보는 null이다(오류가 아니다)', async () => {
    expect(await driver.getObjectInfo('req-1/never-uploaded.pdf')).toBeNull();
  });

  it('같은 경로에는 덮어쓸 수 없다(x-upsert: false)', async () => {
    const path = 'req-1/dup.pdf';
    const first = await driver.createUploadUrl(path);
    expect((await putFile(first.url, Buffer.alloc(10), uploadHeaders)).status).toBe(200);

    const second = await driver.createUploadUrl(path);
    expect((await putFile(second.url, Buffer.alloc(10), uploadHeaders)).status).toBe(409);
  });

  it('저장소가 버킷 크기 제한을 넘는 업로드를 거부한다(413)', async () => {
    const { url } = await driver.createUploadUrl('req-1/too-big.pdf');
    expect((await putFile(url, Buffer.alloc(1001), uploadHeaders)).status).toBe(413);
    expect(await driver.getObjectInfo('req-1/too-big.pdf')).toBeNull();
  });

  it('업로드 토큰은 발급받은 경로에만 쓸 수 있다', async () => {
    const issued = await driver.createUploadUrl('req-1/mine.pdf');
    const otherPath = issued.url.replace('mine.pdf', 'someone-elses.pdf');
    expect((await putFile(otherPath, Buffer.alloc(10), uploadHeaders)).status).toBe(403);
  });

  it('내려받기 주소로 파일을 받을 수 있고 원래 파일 이름으로 저장되도록 표시된다', async () => {
    const path = 'req-1/download.pdf';
    const { url: upload } = await driver.createUploadUrl(path);
    await putFile(upload, Buffer.from('hello pdf'), uploadHeaders);

    const { url } = await driver.createDownloadUrl(path, '한글 이름 (최종).pdf', 60);
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('hello pdf');
    expect(decodeURIComponent(res.headers.get('content-disposition'))).toContain('한글 이름 (최종).pdf');
  });

  it('내려받기 주소는 만료되면 쓸 수 없다', async () => {
    const path = 'req-1/expiring.pdf';
    const { url: upload } = await driver.createUploadUrl(path);
    await putFile(upload, Buffer.from('x'), uploadHeaders);

    const { url } = await driver.createDownloadUrl(path, 'a.pdf', 0); // 즉시 만료
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await fetch(url)).status).toBe(400);
  });

  it('내려받기 주소의 토큰을 지우거나 다른 파일에 쓰면 거부된다', async () => {
    const path = 'req-1/protected.pdf';
    const { url: upload } = await driver.createUploadUrl(path);
    await putFile(upload, Buffer.from('secret'), uploadHeaders);

    const { url } = await driver.createDownloadUrl(path, 'a.pdf', 60);
    expect((await fetch(url.replace(/token=[^&]+/, 'token=forged'))).status).toBe(403);
    expect((await fetch(url.replace(/\?.*$/, ''))).status).toBe(403); // 토큰 없이
  });

  it('파일을 삭제하면 정보가 사라지고, 없는 파일을 지워도 오류가 아니다', async () => {
    const path = 'req-1/remove-me.pdf';
    const { url } = await driver.createUploadUrl(path);
    await putFile(url, Buffer.from('x'), uploadHeaders);
    expect(await driver.getObjectInfo(path)).not.toBeNull();

    await driver.removeObjects([path, 'req-1/never-existed.pdf']);
    expect(await driver.getObjectInfo(path)).toBeNull();
    await expect(driver.removeObjects([])).resolves.toBeUndefined();
  });

  it('서비스 키가 틀리면 예외를 던진다(조용히 실패하지 않는다)', async () => {
    const wrong = createSupabaseStorage({
      SUPABASE_URL: server.url,
      SUPABASE_SERVICE_ROLE_KEY: 'wrong-key',
      SUPABASE_BUCKET: BUCKET,
    });
    await expect(wrong.createUploadUrl('req-1/x.pdf')).rejects.toThrow(/createUploadUrl failed/);
    await expect(wrong.getObjectInfo('req-1/x.pdf')).rejects.toThrow(/getObjectInfo failed/);
    await expect(wrong.createDownloadUrl('req-1/x.pdf', 'x.pdf', 60)).rejects.toThrow(/createDownloadUrl failed/);
    await expect(wrong.removeObjects(['req-1/x.pdf'])).rejects.toThrow(/removeObjects failed/);
  });

  it('저장소에 연결할 수 없으면 예외를 던진다', async () => {
    const unreachable = createSupabaseStorage({
      SUPABASE_URL: 'http://127.0.0.1:1', // 아무도 듣지 않는 포트
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
      SUPABASE_BUCKET: BUCKET,
    });
    await expect(unreachable.getObjectInfo('req-1/x.pdf')).rejects.toThrow();
  });

  it('주소 끝에 슬래시가 있어도 동작한다', async () => {
    const withSlash = createSupabaseStorage({
      SUPABASE_URL: `${server.url}/`,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
      SUPABASE_BUCKET: BUCKET,
    });
    await expect(withSlash.createUploadUrl('req-1/slash.pdf')).resolves.toHaveProperty('url');
  });

  it('서비스 키를 업로드·내려받기 주소로 노출하지 않는다', async () => {
    const { url: uploadUrl } = await driver.createUploadUrl('req-1/leak-check.pdf');
    await putFile(uploadUrl, Buffer.from('x'), uploadHeaders);
    const { url: downloadUrl } = await driver.createDownloadUrl('req-1/leak-check.pdf', 'a.pdf', 60);
    expect(uploadUrl).not.toContain(SERVICE_KEY);
    expect(downloadUrl).not.toContain(SERVICE_KEY);
  });
});
