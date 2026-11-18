import { defineConfig } from 'vitest/config';
import { baseTestEnv } from './vitest.shared.mjs';

// 단위 테스트: DB·외부 서비스에 접속하지 않는다. DB를 쓰는 테스트(*.db.test.js)는
// vitest.db.config.mjs 로 따로 실행한다. (npm run test:db)
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
    exclude: ['**/node_modules/**', '**/*.db.test.js'],
    env: baseTestEnv,
  },
});
