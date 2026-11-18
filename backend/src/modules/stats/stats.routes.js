const express = require('express');
const authenticate = require('../../middleware/authenticate');
const { ROLES, requireRole } = require('../../middleware/roles');
const validate = require('../../middleware/validate');
const controller = require('./stats.controller');
const { hoursQuerySchema, periodQuerySchema } = require('./stats.schemas');

const router = express.Router();

router.use(authenticate);

// 관리자: 대시보드(기간별 완료 건수·평균 처리 시간·유형별 건수, 지원자별 현황)
router.get('/summary', requireRole(ROLES.ADMIN), validate(periodQuerySchema, 'query'), controller.summary);
router.get('/supporters', requireRole(ROLES.ADMIN), validate(periodQuerySchema, 'query'), controller.supporters);
// 관리자: 지원자별 월 근로시간 현황
router.get('/hours', requireRole(ROLES.ADMIN), validate(hoursQuerySchema, 'query'), controller.hours);
// 지원자: 내 근로시간(본인 기록만)
router.get('/my-hours', requireRole(ROLES.SUPPORTER), validate(hoursQuerySchema, 'query'), controller.myHours);

module.exports = router;
