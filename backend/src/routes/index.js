const express = require('express');
const authRoutes = require('../modules/auth/auth.routes');
const adminRoutes = require('../modules/admin/admin.routes');
const attachmentRoutes = require('../modules/attachments/attachment.routes');
const requestRoutes = require('../modules/requests/request.routes');
const statsRoutes = require('../modules/stats/stats.routes');
const supportTypeRoutes = require('../modules/supportTypes/supportType.routes');
const pushRoutes = require('../modules/push/push.routes');
const cronRoutes = require('../modules/cron/cron.routes');
const healthRoutes = require('../modules/health/health.routes');

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/admin', adminRoutes);
router.use('/requests', requestRoutes);
router.use('/attachments', attachmentRoutes);
router.use('/stats', statsRoutes);
router.use('/support-types', supportTypeRoutes);
router.use('/push', pushRoutes);
router.use('/cron', cronRoutes);
router.use('/health', healthRoutes);

module.exports = router;
