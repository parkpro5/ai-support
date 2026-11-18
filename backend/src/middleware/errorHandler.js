const logger = require('../utils/logger');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || 500;
  // expose: 서버 오류 코드(예: 503)여도 사용자에게 이유를 알려 줘야 하는 "예상된 상태"(기능이 꺼져 있음 등).
  // 이런 오류는 메시지를 그대로 보여 주고, 장애가 아니므로 오류 로그도 남기지 않는다.
  const expose = statusCode < 500 || err.expose === true;
  if (statusCode >= 500 && !expose) {
    logger.error(err.stack || err.message);
  }
  res.status(statusCode).json({
    error: {
      message: expose ? err.message : 'Internal server error',
      ...(expose && err.details ? { details: err.details } : {}),
    },
  });
}

module.exports = errorHandler;
