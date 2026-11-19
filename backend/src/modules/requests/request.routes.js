const express = require('express');
const authenticate = require('../../middleware/authenticate');
const { ROLES, requireRole } = require('../../middleware/roles');
const validate = require('../../middleware/validate');
const controller = require('./request.controller');
const attachmentController = require('../attachments/attachment.controller');
const { uploadUrlSchema, registerAttachmentSchema } = require('../attachments/attachment.schemas');
const {
  createRequestSchema,
  updateRequestSchema,
  createWorkLogSchema,
  reviewDecisionSchema,
  ratingSchema,
  assignRequestSchema,
  listRequestsQuerySchema,
} = require('./request.schemas');

const router = express.Router();

router.use(authenticate);

router.get('/', validate(listRequestsQuerySchema, 'query'), controller.list);
// 지원자는 요청서를 작성하지 않는다. 관리자는 작성할 수 있다.
router.post('/', requireRole(ROLES.REQUESTER, ROLES.ADMIN), validate(createRequestSchema), controller.create);
// 새 요청서 작성 화면의 기본값(이름·소속). '/:id' 보다 앞에 둬야 id 로 해석되지 않는다.
router.get('/form-defaults', requireRole(ROLES.REQUESTER, ROLES.ADMIN), controller.formDefaults);
router.get('/:id', controller.get);
router.patch('/:id', validate(updateRequestSchema), controller.update);
router.delete('/:id', controller.remove);
router.post('/:id/accept', requireRole(ROLES.SUPPORTER), controller.accept);
router.post('/:id/cancel-accept', requireRole(ROLES.SUPPORTER), controller.cancelAccept);
router.post(
  '/:id/work-logs',
  requireRole(ROLES.SUPPORTER),
  validate(createWorkLogSchema),
  controller.submitWorkLog
);

// 작성자 본인만 확인할 수 있다. 역할이 아니라 요청서의 작성자인지를 상태 전이에서 검사한다.
router.post('/:id/first-review', validate(reviewDecisionSchema), controller.firstReview);

// 완료된 요청서에 작성자가 만족도를 한 번만 남긴다. 작성자인지는 서비스에서 검사한다(관리자가 쓴 요청서도 그 관리자가 작성자).
router.post('/:id/rating', validate(ratingSchema), controller.rate);

// 첨부파일: 파일은 서버를 거치지 않고 브라우저가 서명된 주소로 저장소에 직접 올린다.
// 1) 업로드 주소 발급 → 2) (브라우저가 저장소에 업로드) → 3) 업로드한 파일 등록
router.post('/:id/attachments/upload-url', validate(uploadUrlSchema), attachmentController.issueUploadUrl);
router.post('/:id/attachments', validate(registerAttachmentSchema), attachmentController.register);

// 관리자만 제출됨 요청서를 지원자에게 직접 배정할 수 있다.
router.post('/:id/assign', requireRole(ROLES.ADMIN), validate(assignRequestSchema), controller.assign);

// 관리자만 최종 확인을 할 수 있다. (상태 전이에서도 관리자 역할을 한 번 더 검사한다.)
router.post(
  '/:id/final-review',
  requireRole(ROLES.ADMIN),
  validate(reviewDecisionSchema),
  controller.finalReview
);

module.exports = router;
