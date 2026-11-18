const ApiError = require('../utils/ApiError');
const { verifyAppToken } = require('../utils/jwt');

function extractToken(req) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme === 'Bearer' && token) return token;
  return null;
}

function authMiddleware(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return next(new ApiError(401, 'Authentication required'));
  }
  try {
    const payload = verifyAppToken(token);
    req.user = { id: payload.sub, email: payload.email, role: payload.role };
    next();
  } catch (err) {
    next(new ApiError(401, 'Invalid or expired token'));
  }
}

module.exports = authMiddleware;
