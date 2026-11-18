const jwt = require('jsonwebtoken');
const env = require('../config/env');

const ALGORITHM = 'HS256';

function signAppToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN, algorithm: ALGORITHM }
  );
}

function verifyAppToken(token) {
  // Pin the algorithm explicitly so a forged token can't switch algorithms
  // (e.g. "none") to bypass signature verification.
  return jwt.verify(token, env.JWT_SECRET, { algorithms: [ALGORITHM] });
}

module.exports = { signAppToken, verifyAppToken };
