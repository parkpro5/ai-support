const express = require('express');
const env = require('../../config/env');
const asyncHandler = require('../../middleware/asyncHandler');
const ApiError = require('../../utils/ApiError');
const { runOnce } = require('../../jobs/reminderScheduler');

const router = express.Router();

function requireCronSecret(req, res, next) {
  const authHeader = req.get('authorization') || '';
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    throw new ApiError(401, 'Unauthorized');
  }
  next();
}

router.post(
  '/reminders',
  requireCronSecret,
  asyncHandler(async (req, res) => {
    const result = await runOnce();
    res.json({ ok: true, ...result });
  })
);

module.exports = router;
