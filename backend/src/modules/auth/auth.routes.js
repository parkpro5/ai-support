const express = require('express');
const authMiddleware = require('../../middleware/authMiddleware');
const controller = require('./auth.controller');

const router = express.Router();

router.get('/google/login', controller.googleLogin);
router.get('/google/callback', controller.googleCallback);
router.get('/me', authMiddleware, controller.me);

module.exports = router;
