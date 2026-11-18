const ApiError = require('../utils/ApiError');

/** Prisma의 Role enum과 같은 값. 역할 문자열을 코드에 직접 쓰지 않기 위한 상수. */
const ROLES = Object.freeze({
  REQUESTER: 'REQUESTER',
  SUPPORTER: 'SUPPORTER',
  ADMIN: 'ADMIN',
});

/**
 * 허용된 역할만 통과시키는 미들웨어를 만든다. authMiddleware 뒤에서 써야 한다.
 * - 인증되지 않음(req.user 없음): 401
 * - 인증됐지만 허용된 역할이 아님: 403
 * @param {...('REQUESTER'|'SUPPORTER'|'ADMIN')} allowedRoles
 * @returns {import('express').RequestHandler}
 */
function requireRole(...allowedRoles) {
  if (allowedRoles.length === 0) {
    throw new Error('requireRole needs at least one role');
  }
  const unknown = allowedRoles.filter((role) => !Object.hasOwn(ROLES, role));
  if (unknown.length > 0) {
    throw new Error(`Unknown role: ${unknown.join(', ')}`);
  }

  return (req, res, next) => {
    if (!req.user) {
      return next(new ApiError(401, 'Authentication required'));
    }
    if (!allowedRoles.includes(req.user.role)) {
      return next(new ApiError(403, 'Insufficient permissions'));
    }
    next();
  };
}

module.exports = { ROLES, requireRole };
