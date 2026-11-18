/**
 * 로컬 가짜 Supabase Storage 서버(HTTP). 테스트와 수동 검증에서 `createSupabaseStorage` 드라이버의
 * "실제 HTTP 호출 코드"를 실행해 보기 위한 것이다. 공식 클라이언트(@supabase/storage-js)가 호출하는 엔드포인트만 흉내 낸다.
 *
 *   POST   /storage/v1/object/upload/sign/{bucket}/{path}   업로드 서명 주소 발급(서비스 키 필요)
 *   PUT    /storage/v1/object/upload/sign/{bucket}/{path}   서명 주소로 업로드(토큰 필요, 크기 제한, 덮어쓰기 금지)
 *   GET    /storage/v1/object/info/{bucket}/{path}          객체 정보(서비스 키 필요)
 *   POST   /storage/v1/object/sign/{bucket}/{path}          내려받기 서명 주소 발급(서비스 키 필요)
 *   GET    /storage/v1/object/sign/{bucket}/{path}?token=   내려받기(토큰 필요, 만료 확인)
 *   DELETE /storage/v1/object/{bucket}                      객체 삭제(서비스 키 필요)
 *
 * 한계: 실제 Supabase가 아니라, 공식 클라이언트 코드에서 읽은 요청·응답 모양을 따른 것이다.
 */
const http = require('http');
const crypto = require('crypto');

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'access-control-allow-headers': '*',
  'access-control-expose-headers': '*',
};

/**
 * @param {{ bucket?: string, serviceKey?: string, maxBytes?: number, port?: number }} [options]
 * @returns {Promise<{ url: string, objects: Map<string, { body: Buffer, contentType: string }>, requests: Array<object>, close: () => Promise<void> }>}
 */
async function startFakeSupabaseStorage({ bucket = 'attachments', serviceKey = 'local-test-key', maxBytes = 10 * 1024 * 1024, port = 0 } = {}) {
  /** path(버킷 제외) → 저장된 객체 */
  const objects = new Map();
  /** token → { path, kind, expiresAt, download? } */
  const tokens = new Map();
  /** 받은 요청 기록(검증용) */
  const requests = [];

  const json = (res, status, body, extra = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...CORS, ...extra });
    res.end(JSON.stringify(body));
  };
  const notFound = (res) => json(res, 404, { statusCode: '404', error: 'not_found', message: 'Object not found' });
  const unauthorized = (res) => json(res, 401, { statusCode: '401', error: 'Unauthorized', message: 'Invalid API key' });
  const hasServiceKey = (req) => req.headers.authorization === `Bearer ${serviceKey}` && req.headers.apikey === serviceKey;

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const url = new URL(req.url, 'http://fake.local');
      requests.push({ method: req.method, path: url.pathname, headers: req.headers, bodyLength: body.length });

      if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS);
        return res.end();
      }

      const prefix = '/storage/v1/object/';
      if (!url.pathname.startsWith(prefix)) return notFound(res);
      const rest = url.pathname.slice(prefix.length); // 예: upload/sign/attachments/<path>
      const decode = (value) => value.split('/').map(decodeURIComponent).join('/');

      // 업로드 서명 주소 발급 / 업로드
      let match = rest.match(/^upload\/sign\/([^/]+)\/(.+)$/);
      if (match && match[1] === bucket) {
        const path = decode(match[2]);
        if (req.method === 'POST') {
          if (!hasServiceKey(req)) return unauthorized(res);
          const token = crypto.randomBytes(16).toString('hex');
          tokens.set(token, { path, kind: 'upload', expiresAt: Date.now() + 2 * 60 * 60 * 1000 });
          return json(res, 200, { url: `/object/upload/sign/${bucket}/${match[2]}?token=${token}` });
        }
        if (req.method === 'PUT') {
          const entry = tokens.get(url.searchParams.get('token'));
          if (!entry || entry.kind !== 'upload' || entry.path !== path || entry.expiresAt < Date.now()) {
            return json(res, 403, { statusCode: '403', error: 'InvalidJWT', message: 'invalid upload token' });
          }
          if (body.length > maxBytes) {
            return json(res, 413, { statusCode: '413', error: 'Payload too large', message: 'The object exceeded the maximum allowed size' });
          }
          if (req.headers['x-upsert'] !== 'true' && objects.has(path)) {
            return json(res, 409, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
          }
          objects.set(path, { body, contentType: req.headers['content-type'] ?? 'application/octet-stream' });
          return json(res, 200, { Key: `${bucket}/${path}` });
        }
      }

      // 객체 정보
      match = rest.match(/^info\/([^/]+)\/(.+)$/);
      if (match && match[1] === bucket && req.method === 'GET') {
        if (!hasServiceKey(req)) return unauthorized(res);
        const stored = objects.get(decode(match[2]));
        if (!stored) return notFound(res);
        return json(res, 200, {
          id: crypto.randomUUID(),
          name: decode(match[2]),
          bucket_id: bucket,
          size: stored.body.length,
          content_type: stored.contentType,
          created_at: new Date().toISOString(),
        });
      }

      // 내려받기 서명 주소 발급 / 내려받기
      match = rest.match(/^sign\/([^/]+)\/(.+)$/);
      if (match && match[1] === bucket) {
        const path = decode(match[2]);
        if (req.method === 'POST') {
          if (!hasServiceKey(req)) return unauthorized(res);
          const payload = JSON.parse(body.toString('utf8') || '{}');
          const token = crypto.randomBytes(16).toString('hex');
          tokens.set(token, { path, kind: 'download', expiresAt: Date.now() + Number(payload.expiresIn ?? 60) * 1000 });
          return json(res, 200, { signedURL: `/object/sign/${bucket}/${match[2]}?token=${token}` });
        }
        if (req.method === 'GET') {
          const entry = tokens.get(url.searchParams.get('token'));
          if (!entry || entry.kind !== 'download' || entry.path !== path) return json(res, 403, { statusCode: '403', error: 'InvalidJWT', message: 'invalid token' });
          if (entry.expiresAt < Date.now()) return json(res, 400, { statusCode: '400', error: 'InvalidJWT', message: 'exp claim timestamp check failed' });
          const stored = objects.get(path);
          if (!stored) return notFound(res);
          const download = url.searchParams.get('download');
          const headers = { 'content-type': stored.contentType, 'content-length': stored.body.length, ...CORS };
          if (download !== null) headers['content-disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(download)}`;
          res.writeHead(200, headers);
          return res.end(stored.body);
        }
      }

      // 삭제
      match = rest.match(/^([^/]+)$/);
      if (match && match[1] === bucket && req.method === 'DELETE') {
        if (!hasServiceKey(req)) return unauthorized(res);
        const { prefixes = [] } = JSON.parse(body.toString('utf8') || '{}');
        for (const path of prefixes) objects.delete(path);
        return json(res, 200, prefixes.map((name) => ({ name })));
      }

      return notFound(res);
    });
  });

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    objects,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

module.exports = { startFakeSupabaseStorage };
