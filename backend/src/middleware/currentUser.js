const prisma = require('../config/prismaClient');
const ApiError = require('../utils/ApiError');

/**
 * authMiddleware 뒤에서 쓴다. 토큰이 담고 있는 역할은 로그인 시점의 값이라 최대 7일간 낡을 수 있으므로,
 * 요청마다 DB의 현재 사용자 정보로 `req.user`를 다시 채운다.
 * - 관리자가 역할을 바꾸면 다음 요청부터 바로 반영된다(지원자로 지정되면 재로그인 없이 접수 가능, 해제되면 즉시 차단).
 * - 삭제된 사용자의 토큰은 401로 거부한다.
 */
async function loadCurrentUser(req, res, next) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, email: true, role: true },
    });
    if (!user) return next(new ApiError(401, 'Invalid or expired token'));
    req.user = { id: user.id, email: user.email, role: user.role };
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = loadCurrentUser;
