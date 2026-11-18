/**
 * DB 테스트용 데이터베이스를 만들고 마이그레이션을 적용한다. (npm run test:db:setup)
 * 여러 번 실행해도 안전하다. 로컬 `_test` DB가 아니면 아무것도 하지 않고 중단한다.
 */
const path = require('path');
const { spawnSync } = require('child_process');
const { PrismaClient } = require('@prisma/client');
const { getTestDatabaseUrl, assertSafeTestDatabaseUrl } = require('../src/test/testDatabase');

async function ensureDatabase({ database, adminUrl }) {
  const admin = new PrismaClient({ datasourceUrl: adminUrl });
  try {
    const rows = await admin.$queryRaw`select 1 from pg_database where datname = ${database}`;
    if (rows.length > 0) {
      console.log(`테스트 DB가 이미 있습니다: ${database}`);
      return;
    }
    // 식별자는 assertSafeTestDatabaseUrl 에서 [a-z0-9_] 만 허용하도록 검증했다.
    await admin.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
    console.log(`테스트 DB를 만들었습니다: ${database}`);
  } finally {
    await admin.$disconnect();
  }
}

function migrate(url) {
  const schema = path.join(__dirname, '..', 'prisma', 'schema.prisma');
  // shell 없이 Prisma CLI를 직접 실행한다. (인자를 셸에 넘기지 않으므로 안전하다.)
  const prismaCli = require.resolve('prisma/build/index.js');
  const result = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy', '--schema', schema], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
  });
  if (result.status !== 0) throw new Error('마이그레이션 적용에 실패했습니다.');
}

(async () => {
  const target = assertSafeTestDatabaseUrl(getTestDatabaseUrl());
  await ensureDatabase(target);
  migrate(target.url);
  console.log('준비 완료. `npm run test:db`로 DB 테스트를 실행하세요.');
})().catch((err) => {
  console.error(`중단: ${err.message}`);
  process.exit(1);
});
