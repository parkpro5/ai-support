import { createRequire } from 'node:module';
import { defineConfig } from 'vitest/config';
import webpush from 'web-push';
import { baseTestEnv } from './vitest.shared.mjs';

const require = createRequire(import.meta.url);
const { getTestDatabaseUrl, assertSafeTestDatabaseUrl } = require('./src/test/testDatabase.js');

// 안전하지 않은 주소면 여기서 바로 중단한다. (설정 파일을 읽는 시점)
const { url } = assertSafeTestDatabaseUrl(getTestDatabaseUrl());

// 앱 전체(app.js)를 불러오므로 web-push가 받아들이는 형식의 키가 필요하다. 매번 새로 만든 일회용 값이다.
const vapid = webpush.generateVAPIDKeys();

// DB 테스트: 전용 테스트 DB에서만 실행한다. 파일끼리 같은 DB를 쓰므로 순서대로 실행한다.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.db.test.js'],
    exclude: ['**/node_modules/**'],
    fileParallelism: false,
    globalSetup: ['./src/test/dbGlobalSetup.js'],
    // 모든 테스트 파일 시작 전에 실제 푸시 전송을 막는다.
    setupFiles: ['./src/test/dbSetup.js'],
    env: {
      ...baseTestEnv,
      VAPID_PUBLIC_KEY: vapid.publicKey,
      VAPID_PRIVATE_KEY: vapid.privateKey,
      // 이 값이 앱(Prisma)이 쓰는 DB가 된다. backend/.env 의 값은 이미 설정된 환경변수를 덮어쓰지 못한다.
      DATABASE_URL: url,
      DIRECT_URL: url,
      TEST_DATABASE_URL: url,
    },
  },
});
