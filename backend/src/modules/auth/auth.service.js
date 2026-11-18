const prisma = require('../../config/prismaClient');
const env = require('../../config/env');
const { signAppToken } = require('../../utils/jwt');

function isAdminEmail(email) {
  return env.adminEmailList.includes(email.toLowerCase());
}

/**
 * Google 프로필로 사용자를 찾거나 새로 만든다.
 * - 최초 생성: ADMIN_EMAILS에 있으면 ADMIN, 관리자가 그 이메일을 지원자로 미리 등록해 두었으면 SUPPORTER, 아니면 REQUESTER.
 *   미리 등록은 Google이 이메일 소유를 확인한(emailVerified) 로그인에만 적용하고, 적용하면 그 대기 등록은 지운다.
 * - 기존 사용자: 역할을 덮어쓰지 않는다. 다만 ADMIN_EMAILS 대상은 항상 ADMIN으로 올린다.
 *   (관리자가 지정한 SUPPORTER 역할은 로그인으로 바뀌지 않는다.)
 * @param {{ googleId: string, email: string, name: string }} profile
 */
async function upsertUserFromGoogle({ googleId, email, name, emailVerified = false }) {
  const existing = await prisma.user.findUnique({ where: { googleId } });

  if (!existing) {
    const invitedEmail = email.toLowerCase();
    // 사용자 생성과 대기 등록 삭제를 한 번에 처리해, 둘 중 하나만 반영되는 일이 없게 한다.
    return prisma.$transaction(async (tx) => {
      const invite = emailVerified ? await tx.supporterInvite.findUnique({ where: { email: invitedEmail } }) : null;
      let role = 'REQUESTER';
      if (isAdminEmail(email)) role = 'ADMIN';
      else if (invite) role = 'SUPPORTER';

      const user = await tx.user.create({ data: { googleId, email, name, role } });
      if (invite) await tx.supporterInvite.deleteMany({ where: { email: invitedEmail } });
      return user;
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
