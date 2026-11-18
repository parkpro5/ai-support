const prisma = require('../../config/prismaClient');
const env = require('../../config/env');
const { signAppToken } = require('../../utils/jwt');

function isAdminEmail(email) {
  return env.adminEmailList.includes(email.toLowerCase());
}

/**
 * Google 프로필로 사용자를 찾거나 새로 만든다.
 * - 최초 생성: ADMIN_EMAILS에 있으면 ADMIN, 아니면 REQUESTER.
 * - 기존 사용자: 역할을 덮어쓰지 않는다. 다만 ADMIN_EMAILS 대상은 항상 ADMIN으로 올린다.
 *   (관리자가 지정한 SUPPORTER 역할은 로그인으로 바뀌지 않는다.)
 * @param {{ googleId: string, email: string, name: string }} profile
 */
async function upsertUserFromGoogle({ googleId, email, name }) {
  const existing = await prisma.user.findUnique({ where: { googleId } });

  if (!existing) {
    return prisma.user.create({
      data: { googleId, email, name, role: isAdminEmail(email) ? 'ADMIN' : 'REQUESTER' },
    });
  }

  if (isAdminEmail(email) && existing.role !== 'ADMIN') {
    return prisma.user.update({ where: { id: existing.id }, data: { role: 'ADMIN' } });
  }
  return existing;
}

function toPublicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  };
}

module.exports = { upsertUserFromGoogle, toPublicUser, signAppToken };
