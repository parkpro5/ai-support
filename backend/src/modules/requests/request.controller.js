const asyncHandler = require('../../middleware/asyncHandler');
const service = require('./request.service');

const list = asyncHandler(async (req, res) => {
  res.json(await service.listRequests(req.user, req.query));
});

const formDefaults = asyncHandler(async (req, res) => {
  res.json(await service.getFormDefaults(req.user));
});

const get = asyncHandler(async (req, res) => {
  res.json(await service.getRequest(req.user, req.params.id));
});

const create = asyncHandler(async (req, res) => {
  res.status(201).json(await service.createRequest(req.user, req.body));
});

const update = asyncHandler(async (req, res) => {
  res.json(await service.updateRequest(req.user, req.params.id, req.body));
});

const remove = asyncHandler(async (req, res) => {
  await service.deleteRequest(req.user, req.params.id);
  res.status(204).end();
});

const rate = asyncHandler(async (req, res) => {
  res.status(201).json(await service.rateRequest(req.user, req.params.id, req.body));
});

const accept = asyncHandler(async (req, res) => {
  res.json(await service.acceptRequest(req.user, req.params.id));
});

const cancelAccept = asyncHandler(async (req, res) => {
  res.json(await service.cancelAcceptRequest(req.user, req.params.id));
});

const submitWorkLog = asyncHandler(async (req, res) => {
  res.status(201).json(await service.submitWorkLog(req.user, req.params.id, req.body));
});

const firstReview = asyncHandler(async (req, res) => {
  res.json(await service.reviewFirst(req.user, req.params.id, req.body));
});

const finalReview = asyncHandler(async (req, res) => {
  res.json(await service.reviewFinal(req.user, req.params.id, req.body));
});

const assign = asyncHandler(async (req, res) => {
  res.json(await service.assignRequest(req.user, req.params.id, req.body));
});

module.exports = {
  list,
  formDefaults,
  get,
  create,
  update,
  remove,
  accept,
  cancelAccept,
  submitWorkLog,
  firstReview,
  finalReview,
  assign,
  rate,
};
