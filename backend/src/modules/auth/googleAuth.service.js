const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const env = require('../../config/env');

// 로그인에는 신원 정보만 필요하다.
const LOGIN_SCOPES = ['openid', 'email', 'profile'];

function createLoginClient() {
  return new OAuth2Client(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_REDIRECT_URI
  );
}

function signState(payload) {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: '10m' });
}

function verifyState(state) {
  return jwt.verify(state, env.JWT_SECRET);
}

/** @returns {{ url: string, nonce: string }} Google 동의 화면 URL과 CSRF 방지용 nonce */
function buildLoginAuthUrl() {
  const nonce = crypto.randomBytes(16).toString('hex');
  const state = signState({ purpose: 'login', nonce });
  const url = createLoginClient().generateAuthUrl({
    scope: LOGIN_SCOPES,
    prompt: 'select_account',
    state,
  });
  return { url, nonce };
}

/**
 * @param {string} code Google이 콜백으로 준 인가 코드
 * @returns {Promise<{ googleId: string, email: string, name: string, emailVerified: boolean }>}
 */
async function exchangeLoginCode(code) {
  const client = createLoginClient();
  const { tokens } = await client.getToken(code);
  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: env.GOOGLE_CLIENT_ID,
  });
  const profile = ticket.getPayload();
  return {
    googleId: profile.sub,
    email: profile.email,
    name: profile.name || profile.email,
    // Google이 이메일 소유를 확인했는지. 지원자 사전 등록은 확인된 이메일에만 적용한다.
    emailVerified: profile.email_verified === true,
  };
}

module.exports = { verifyState, buildLoginAuthUrl, exchangeLoginCode };
