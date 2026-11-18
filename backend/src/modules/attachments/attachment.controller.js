const asyncHandler = require('../../middleware/asyncHandler');
const service = require('./attachment.service');

const issueUploadUrl = asyncHandler(async (req, res) => {
  res.json(await service.issueUploadUrl(req.user, req.params.id, req.body));
});

const register = asyncHandler(async (req, res) => {
  res.status(201).json(await service.registerAttachment(req.user, req.params.id, req.body));
});

const downloadUrl = asyncHandler(async (req, res) => {
  res.json(await service.createDownloadUrl(req.user, req.params.id));
});

const remove = asyncHandler(async (req, res) => {
  await service.deleteAttachment(req.user, req.params.id);
  res.status(204).end();
});

module.exports = { issueUploadUrl, register, downloadUrl, remove };
