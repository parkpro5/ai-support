const express = require('express');
const authenticate = require('../../middleware/authenticate');
const { ROLES, requireRole } = require('../../middleware/roles');
const validate = require('../../middleware/validate');
const controller = require('./admin.controller');
const {
  listUsersQuerySchema,
  updateUserRoleSchema,
  createSupportTypeSchema,
  updateSupportTypeSchema,
} = require('./admin.schemas');

const router = express.Router();

// 이 아래의 모든 API는 관리자 전용이다.
router.use(authenticate, requireRole(ROLES.ADMIN));

router.get('/users', validate(listUsersQuerySchema, 'query'), controller.listUsers);
router.patch('/users/:id/role', validate(updateUserRoleSchema), controller.updateUserRole);

router.get('/support-types', controller.listSupportTypes);
router.post('/support-types', validate(createSupportTypeSchema), controller.createSupportType);
router.patch('/support-types/:id', validate(updateSupportTypeSchema), controller.updateSupportType);

module.exports = router;
