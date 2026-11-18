require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const DEFAULT_SUPPORT_TYPES = ['업무 자동화', '문서 작성', '데이터 정리', '교육·컨설팅', '기타'];

/** 지원 유형 기본 목록을 넣는다. 여러 번 실행해도 중복되지 않는다. */
async function main() {
  for (const [index, name] of DEFAULT_SUPPORT_TYPES.entries()) {
    await prisma.supportType.upsert({
      where: { name },
      create: { name, sortOrder: index },
      update: {},
    });
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
