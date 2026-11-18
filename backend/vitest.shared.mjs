// 단위 테스트와 DB 테스트가 함께 쓰는 환경변수. config/env.js 의 필수값 검사를 통과하기 위한
// 더미 값이며 실제 비밀값은 쓰지 않는다.
export const baseTestEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  JWT_SECRET: 'test-jwt-secret-for-vitest-only',
  ADMIN_EMAILS: 'admin@example.com',
  GOOGLE_CLIENT_ID: 'test-client-id',
  GOOGLE_CLIENT_SECRET: 'test-client-secret',
  GOOGLE_REDIRECT_URI: 'http://localhost:4000/api/auth/google/callback',
  FRONTEND_URL: 'http://localhost:5173',
  VAPID_PUBLIC_KEY: 'test',
  VAPID_PRIVATE_KEY: 'test',
  VAPID_SUBJECT: 'mailto:test@example.com',
  CRON_SECRET: 'test-cron-secret',
  // 일부러 빈 값으로 설정한다. 설정된 값은 dotenv가 .env 의 실제 Supabase 키로 덮어쓰지 못하므로,
  // 테스트가 실제 저장소에 접속하는 일이 없다.
  SUPABASE_URL: '',
  SUPABASE_SERVICE_ROLE_KEY: '',
};
