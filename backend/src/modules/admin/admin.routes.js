const express = require('express');
const authenticate = require('../../middleware/authenticate');
const { ROLES, requireRole } = require('../../middleware/roles');
const validate = require('../../middleware/validate');
const controller = require('./admin.controller');
const {
  listUsersQuerySchema,
  updateUserRoleSchema,
  registerSupportersSchema,
  createSupportTypeSchema,
  updateSupportTypeSchema,
} = require('./admin.schemas');

const router = express.Router();

// 이 아래의 모든 API는 관리자 전용이다.
router.use(authenticate, requireRole(ROLES.ADMIN));

router.get('/users', validate(listUsersQuerySchema, 'query'), controller.listUsers);
router.patch('/users/:id/role', validate(updateUserRoleSchema), controller.updateUserRole);

// 지원자를 이메일로 미리 등록한다(이미 가입한 사람은 바로 지원자로, 아직이면 첫 로그인 때 지원자로 시작).
router.post('/supporters', validate(registerSupportersSchema), controller.registerSupporters);
router.get('/supporter-invites', controller.listSupporterInvites);
router.delete('/supporter-invites/:id', controller.deleteSupporterInvite);

router.get('/support-types', controller.listSupportTypes);
router.post('/support-types', validate(createSupportTypeSchema), controller.createSupportType);
router.patch('/support-types/:id', validate(updateSupportTypeSchema), controller.updateSupportType);

module.exports = router;
