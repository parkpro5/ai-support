/**
 * DB 테스트용 데이터 생성·정리 도구. 만든 행을 기억해 두었다가 cleanup()으로 모두 지운다.
 * 반드시 테스트 DB(vitest.db.config.mjs)에서만 쓴다.
 */
const crypto = require('crypto');
const prisma = require('../config/prismaClient');
const { signAppToken } = require('../utils/jwt');

const created = { userIds: [], typeIds: [] };

/** @param {'REQUESTER'|'SUPPORTER'|'ADMIN'} role */
async function createUser(role = 'REQUESTER') {
  const tag = crypto.randomBytes(6).toString('hex');
  const user = await prisma.user.create({
    data: { googleId: `test-${tag}`, email: `test-${tag}@example.com`, name: `테스트-${role}-${tag}`, role },
  });
  created.userIds.push(user.id);
  return user;
}

async function createSupportType() {
  const tag = crypto.randomBytes(6).toString('hex');
  const type = await prisma.supportType.create({ data: { name: `테스트유형-${tag}` } });
  created.typeIds.push(type.id);
  return type;
}

/**
 * @param {{ requester: object, supportType: object, status?: string, assignee?: object|null } & object} options
 */
async function createRequest({ requester, supportType, assignee = null, ...overrides }) {
  return prisma.request.create({
    data: {
      requesterId: requester.id,
      assigneeId: assignee ? assignee.id : null,
      supportTypeId: supportType.id,
      title: '테스트 요청서',
      content: '테스트 내용',
      department: '테스트 부서',
      contactName: '홍길동',
      contactPhone: '010-1234-5678',
      interviewAt: new Date('2026-11-20T01:00:00.000Z'),
      desiredDate: new Date('2026-12-01T00:00:00.000Z'),
      ...overrides,
    },
  });
}

function tokenFor(user) {
  return signAppToken(user);
}

/** 이 파일이 만든 데이터를 모두 지운다. (요청서를 지우면 이력·작업내역·첨부·평가도 함께 지워진다.) */
async function cleanup() {
  const { userIds, typeIds } = created;
  if (userIds.length > 0) {
    await prisma.request.deleteMany({
      where: { OR: [{ requesterId: { in: userIds } }, { assigneeId: { in: userIds } }] },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  if (typeIds.length > 0) {
    await prisma.supportType.deleteMany({ where: { id: { in: typeIds } } });
  }
  created.userIds = [];
  created.typeIds = [];
}

module.exports = { prisma, createUser, createSupportType, createRequest, tokenFor, cleanup };
