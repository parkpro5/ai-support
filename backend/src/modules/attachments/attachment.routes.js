const express = require('express');
const authenticate = require('../../middleware/authenticate');
const controller = require('./attachment.controller');

const router = express.Router();

router.use(authenticate);

// 내려받기 주소 발급, 삭제. (업로드 주소 발급과 등록은 요청서 아래의 /api/requests/:id/attachments 에 있다.)
router.get('/:id/download-url', controller.downloadUrl);
router.delete('/:id', controller.remove);

module.exports = router;
