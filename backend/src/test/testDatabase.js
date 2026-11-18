/**
 * DB를 쓰는 테스트(*.db.test.js)가 접속할 전용 데이터베이스 설정과 안전장치.
 *
 * 이 테스트는 데이터를 만들고 지운다. 개발·운영 DB(예: backend/.env 가 가리키는 Supabase)에
 * 실수로 붙지 않도록, 아래 두 조건을 모두 만족하는 주소가 아니면 즉시 중단한다.
 *  1. 호스트가 로컬(localhost, 127.0.0.1, ::1)이다.
 *  2. 데이터베이스 이름이 `_test`로 끝난다.
 */
const DEFAULT_TEST_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5433/ai_support_test';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** 테스트 DB 주소. TEST_DATABASE_URL 환경변수가 있으면 그것을 쓴다. (DATABASE_URL은 절대 쓰지 않는다.) */
function getTestDatabaseUrl() {
  return process.env.TEST_DATABASE_URL || DEFAULT_TEST_DATABASE_URL;
}

/**
 * 안전한 테스트 DB 주소인지 검사한다. 아니면 예외를 던진다.
 * @param {string} url
 * @returns {{ url: string, database: string, adminUrl: string }} adminUrl은 DB를 만들 때 쓰는 `postgres` DB 주소
 */
function assertSafeTestDatabaseUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('TEST_DATABASE_URL 형식이 올바르지 않습니다.');
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!LOCAL_HOSTS.has(parsed.hostname)) {
    throw new Error(
      `테스트 DB가 로컬이 아닙니다 (host=${parsed.hostname}). DB 테스트는 로컬 DB에서만 실행합니다.`
    );
  }
  if (!/^[a-z0-9_]+_test$/.test(database)) {
    throw new Error(`테스트 DB 이름은 "_test"로 끝나야 합니다 (현재: ${database || '(없음)'}).`);
  }

  const admin = new URL(url);
  admin.pathname = '/postgres';
  return { url, database, adminUrl: admin.toString() };
}

module.exports = { DEFAULT_TEST_DATABASE_URL, getTestDatabaseUrl, assertSafeTestDatabaseUrl };
