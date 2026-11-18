const authMiddleware = require('./authMiddleware');
const loadCurrentUser = require('./currentUser');

/**
 * 로그인이 필요한 API에 쓰는 인증 단계: 토큰 검증 → DB의 현재 사용자·역할로 갱신.
 * `router.use(authenticate)` 처럼 배열 그대로 넘기면 된다.
 */
module.exports = [authMiddleware, loadCurrentUser];
