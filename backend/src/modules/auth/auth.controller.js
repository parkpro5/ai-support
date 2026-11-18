const prisma = require('../../config/prismaClient');
const env = require('../../config/env');
const asyncHandler = require('../../middleware/asyncHandler');
const ApiError = require('../../utils/ApiError');
const googleAuthService = require('./googleAuth.service');
const authService = require('./auth.service');

const NONCE_COOKIE = 'oauth_login_nonce';

const googleLogin = asyncHandler(async (req, res) => {
  const { url, nonce } = googleAuthService.buildLoginAuthUrl();
  res.cookie(NONCE_COOKIE, nonce, {
    httpOnly: true,
    // Base this on the actual connection, not NODE_ENV: this stack is deployed
    // over plain HTTP (no TLS termination), and a Secure cookie would never be
    // sent back on the callback request over http://, breaking the state check.
    secure: req.secure,
    sameSite: 'lax',
    maxAge: 10 * 60 * 1000,
  });
  res.redirect(url);
});

const googleCallback = asyncHandler(async (req, res) => {
  const { code, state, error } = req.query;
  res.clearCookie(NONCE_COOKIE);

  if (error) {
    return res.redirect(`${env.FRONTEND_URL}/login?error=access_denied`);
  }

  let statePayload;
  try {
    statePayload = googleAuthService.verifyState(state);
  } catch (err) {
    throw new ApiError(400, 'Invalid or expired OAuth state');
  }

  if (statePayload.purpose !== 'login' || statePayload.nonce !== req.cookies[NONCE_COOKIE]) {
    throw new ApiError(400, 'OAuth state validation failed');
  }

  const profile = await googleAuthService.exchangeLoginCode(code);
  const user = await authService.upsertUserFromGoogle(profile);
  const token = authService.signAppToken(user);

  res.redirect(`${env.FRONTEND_URL}/oauth/callback#token=${encodeURIComponent(token)}`);
});

const me = asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) throw new ApiError(404, 'User not found');
  res.json(authService.toPublicUser(user));
});

module.exports = { googleLogin, googleCallback, me };
