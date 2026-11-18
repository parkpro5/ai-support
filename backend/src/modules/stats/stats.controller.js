const asyncHandler = require('../../middleware/asyncHandler');
const service = require('./stats.service');

const hours = asyncHandler(async (req, res) => {
  res.json(await service.hoursForAdmin(req.query));
});

const myHours = asyncHandler(async (req, res) => {
  res.json(await service.hoursForSupporter(req.user, req.query));
});

const summary = asyncHandler(async (req, res) => {
  res.json(await service.dashboardSummary(req.query));
});

const supporters = asyncHandler(async (req, res) => {
  res.json(await service.dashboardSupporters(req.query));
});

module.exports = { hours, myHours, summary, supporters };
