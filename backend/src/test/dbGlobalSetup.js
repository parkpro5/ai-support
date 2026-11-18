// DB 테스트를 시작하기 전에 한 번 실행된다. 안전하지 않거나 준비되지 않은 DB면 테스트를 시작하지 않는다.
import prismaPkg from '@prisma/client';
import testDatabase from './testDatabase.js';

const { PrismaClient } = prismaPkg;
const { getTestDatabaseUrl, assertSafeTestDatabaseUrl } = testDatabase;

export default async function setup() {
  const { url, database } = assertSafeTestDatabaseUrl(getTestDatabaseUrl());
  const prisma = new PrismaClient({ datasourceUrl: url });

  try {
    const [row] = await prisma.$queryRaw`select current_database() as db`;
    // 주소가 아니라 실제로 연결된 DB 이름까지 다시 확인한다.
    if (row.db !== database || !row.db.endsWith('_test')) {
      throw new Error(`연결된 DB(${row.db})가 테스트 DB(${database})와 다릅니다. 중단합니다.`);
    }
    const [{ ready }] = await prisma.$queryRaw`
      select to_regclass('public."Request"') is not null as ready`;
    if (!ready) {
      throw new Error('테스트 DB에 스키마가 없습니다. 먼저 `npm run test:db:setup`을 실행하세요.');
    }
  } catch (err) {
    const hint = /Can't reach|ECONNREFUSED|does not exist|P1001|P1003/.test(String(err.message))
      ? '\n테스트 DB가 없거나 켜져 있지 않습니다. `npm run test:db:setup`으로 만들 수 있습니다. (README의 "테스트" 절 참고)'
      : '';
    throw new Error(`DB 테스트를 시작할 수 없습니다: ${err.message}${hint}`);
  } finally {
    await prisma.$disconnect();
  }
}
