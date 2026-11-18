const express = require('express');
const prisma = require('../../config/prismaClient');
const authenticate = require('../../middleware/authenticate');
const asyncHandler = require('../../middleware/asyncHandler');

const router = express.Router();

router.use(authenticate);

// 요청서 작성 화면의 선택 목록. 사용 중인 유형만 보여준다. (관리·수정은 T-12)
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const types = await prisma.supportType.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true },
    });
    res.json(types);
  })
);

module.exports = router;
