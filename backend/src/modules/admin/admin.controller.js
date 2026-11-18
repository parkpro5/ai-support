const asyncHandler = require('../../middleware/asyncHandler');
const service = require('./admin.service');

const listUsers = asyncHandler(async (req, res) => {
  res.json(await service.listUsers(req.query));
});

const updateUserRole = asyncHandler(async (req, res) => {
  res.json(await service.updateUserRole(req.params.id, req.body.role));
});

const listSupportTypes = asyncHandler(async (req, res) => {
  res.json(await service.listSupportTypes());
});

const createSupportType = asyncHandler(async (req, res) => {
  res.status(201).json(await service.createSupportType(req.body));
});

const updateSupportType = asyncHandler(async (req, res) => {
  res.json(await service.updateSupportType(req.params.id, req.body));
});

module.exports = { listUsers, updateUserRole, listSupportTypes, createSupportType, updateSupportType };
