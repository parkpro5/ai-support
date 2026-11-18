const express = require('express');
const authenticate = require('../../middleware/authenticate');
const validate = require('../../middleware/validate');
const controller = require('./push.controller');
const { subscribeSchema, unsubscribeSchema } = require('./push.schemas');

const router = express.Router();

router.use(authenticate);

router.post('/subscribe', validate(subscribeSchema), controller.subscribe);
router.post('/unsubscribe', validate(unsubscribeSchema), controller.unsubscribe);

module.exports = router;
