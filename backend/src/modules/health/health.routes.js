const express = require('express');
const prisma = require('../../config/prismaClient');
const asyncHandler = require('../../middleware/asyncHandler');
const logger = require('../../utils/logger');

const router = express.Router();

/**
 * 헬스체크. 로그인 없이 부를 수 있고, 데이터베이스에 실제로 질의(SELECT 1)한다.
 *
 * 외부 스케줄러(cron-job.org 등)가 주기적으로 부르면 Supabase 무료 플랜의 "7일간 활동 없음 → 프로젝트 일시중지"를
 * 막는 데 쓸 수 있다. 앱 서버만 확인하고 DB를 건드리지 않으면 이 용도로 소용이 없다.
 *
 * 응답에는 상태 값만 담는다(주소·오류 내용·버전 등 내부 정보는 내보내지 않는다). 실패하면 503.
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ok', db: 'ok' });
    } catch (err) {
      logger.error(`health check: database query failed: ${err.message}`);
      res.status(503).json({ status: 'error', db: 'down' });
    }
  }),
);

module.exports = router;
