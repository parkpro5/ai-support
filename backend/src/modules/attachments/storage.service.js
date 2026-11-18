/**
 * 첨부파일 저장소(Supabase Storage). 파일은 서버를 거치지 않고 브라우저가 서명된 주소로 직접 올린다
 * (Vercel 서버리스 함수의 요청 본문 제한 4.5MB 때문). 서버는 주소를 발급하고, 올라온 파일을 확인하고, 지운다.
 * 버킷은 반드시 비공개여야 한다. 내려받기는 짧은 시간만 유효한 서명 주소로만 한다.
 */
const { StorageClient } = require('@supabase/storage-js');
const env = require('../../config/env');
const ApiError = require('../../utils/ApiError');

const PLACEHOLDER_KEYS = new Set(['', 'your-service-role-key']);

/** 저장소 설정이 실제 값으로 채워져 있는지. (.env.example의 자리표시 값은 설정되지 않은 것으로 본다.) */
function isConfigured(config = env) {
  const key = (config.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  if (PLACEHOLDER_KEYS.has(key)) return false;
  try {
    const url = new URL(config.SUPABASE_URL ?? '');
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

const isNotFound = (error) =>
  Boolean(error) &&
  (Number(error.status) === 404 ||
    Number(error.statusCode) === 404 ||
    /not.?found|NoSuchKey/i.test(`${error.message ?? ''} ${error.code ?? ''} ${error.error ?? ''}`));

/**
 * 운영용 구현. 저장소 클라이언트는 `{ data, error }`를 돌려주므로 오류를 예외로 바꾼다.
 * @param {typeof env} config
 */
function createSupabaseStorage(config = env) {
  const key = config.SUPABASE_SERVICE_ROLE_KEY;
  const client = new StorageClient(`${config.SUPABASE_URL.replace(/\/+$/, '')}/storage/v1`, {
    apikey: key,
    Authorization: `Bearer ${key}`,
  });
  const bucket = client.from(config.SUPABASE_BUCKET);

  const fail = (what, error) => new Error(`Storage ${what} failed: ${error.message ?? error}`);

  return {
    /** 브라우저가 파일을 직접 올릴 서명 주소. 같은 경로에 덮어쓰지 못한다. */
    async createUploadUrl(path) {
      const { data, error } = await bucket.createSignedUploadUrl(path);
      if (error) throw fail('createUploadUrl', error);
      return { url: data.signedUrl };
    },

    /** 올라온 파일의 실제 크기·형식. 없으면 null. */
    async getObjectInfo(path) {
      const { data, error } = await bucket.info(path);
      if (error) {
        if (isNotFound(error)) return null;
        throw fail('getObjectInfo', error);
      }
      return { size: Number(data.size ?? 0), contentType: data.contentType ?? null };
    },

    /** 짧은 시간만 유효한 내려받기 주소. 저장된 이름이 아니라 원래 파일 이름으로 저장되게 한다. */
    async createDownloadUrl(path, fileName, expiresIn) {
      // 클라이언트의 `download` 옵션은 쓰지 않는다. 한글 같은 ASCII 밖 이름을 두 번 인코딩해서(%25ED…)
      // 저장소가 "%ED%95…"라는 글자 그대로를 이름으로 받게 된다. 주소를 받은 뒤 이름을 직접 한 번만 인코딩해 붙인다.
      const { data, error } = await bucket.createSignedUrl(path, expiresIn);
      if (error) throw fail('createDownloadUrl', error);
      return { url: `${data.signedUrl}&download=${encodeURIComponent(fileName)}` };
    },

    async removeObjects(paths) {
      if (paths.length === 0) return;
      const { error } = await bucket.remove(paths);
      if (error) throw fail('removeObjects', error);
    },
  };
}

/**
 * 테스트가 가짜 저장소를 끼우는 자리. 테스트 실행기가 이 모듈을 두 번 불러 복사본이 둘이 될 수 있으므로
 * 모듈 변수가 아니라 전역 심볼에 둔다(푸시 전송기와 같은 방식). 운영에서는 쓰이지 않는다.
 */
const STORAGE_OVERRIDE = Symbol.for('ai-support.storageOverride');

function setStorage(storage) {
  globalThis[STORAGE_OVERRIDE] = storage;
}

function resetStorage() {
  delete globalThis[STORAGE_OVERRIDE];
}

let cached = null;

/**
 * 쓸 저장소를 돌려준다. 설정되지 않았으면 503으로 첨부 기능만 막고 나머지는 영향이 없다.
 * @throws {ApiError} 503
 */
function getStorage() {
  if (globalThis[STORAGE_OVERRIDE]) return globalThis[STORAGE_OVERRIDE];
  if (!isConfigured()) {
    // 장애가 아니라 "첨부 기능이 꺼져 있는" 상태이므로 이유를 사용자에게 그대로 보여 준다.
    const err = new ApiError(503, '파일 저장소가 설정되지 않아 첨부파일을 사용할 수 없습니다. 관리자에게 문의해 주세요');
    err.expose = true;
    throw err;
  }
  if (!cached) cached = createSupabaseStorage();
  return cached;
}

module.exports = { isConfigured, createSupabaseStorage, getStorage, setStorage, resetStorage, isNotFound };
