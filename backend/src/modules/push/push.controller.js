const asyncHandler = require('../../middleware/asyncHandler');
const service = require('./push.service');

const subscribe = asyncHandler(async (req, res) => {
  await service.upsertSubscription(req.user.id, req.body);
  res.status(201).json({ success: true });
});

const unsubscribe = asyncHandler(async (req, res) => {
  await service.removeSubscription(req.user.id, req.body.endpoint);
  res.json({ success: true });
});

module.exports = { subscribe, unsubscribe };
