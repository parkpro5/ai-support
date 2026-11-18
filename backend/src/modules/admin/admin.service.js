const prisma = require('../../config/prismaClient');
const ApiError = require('../../utils/ApiError');
const { STATUS } = require('../requests/stateMachine');

const USER_SELECT = { id: true, email: true, name: true, role: true, createdAt: true };

// ── 사용자·역할 ──────────────────────────────────────────────

async function listUsers({ role, q, page, pageSize }) {
  const where = {
    ...(role ? { role } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { email: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const [items, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      select: USER_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.user.count({ where }),
  ]);
  return { items, page, pageSize, total };
}

/**
 * 사용자를 요청자 ↔ 지원자로 바꾼다.
 * - 관리자 계정의 역할은 바꿀 수 없다(403). ADMIN_EMAILS로 정해지는 값이기 때문이다.
 * - 진행 중인(완료되지 않은) 담당 요청서가 있는 지원자는 해제할 수 없다(409).
 *   지원자 역할을 잃으면 그 요청서를 처리할 사람이 없어지기 때문이다.
 * 역할은 다음 요청부터 바로 적용된다(요청마다 DB의 현재 역할을 읽는다).
 */
async function updateUserRole(id, role) {
  const target = await prisma.user.findUnique({ where: { id }, select: USER_SELECT });
  if (!target) throw new ApiError(404, '사용자를 찾을 수 없습니다');
  if (target.role === 'ADMIN') throw new ApiError(403, '관리자 계정의 역할은 바꿀 수 없습니다');
  if (target.role === role) return target;

  return prisma.$transaction(async (tx) => {
    // 읽은 뒤 갱신하기 전에 관리자로 올라간 계정을 덮어쓰지 않도록 조건에 건다.
    const { count } = await tx.user.updateMany({ where: { id, role: { not: 'ADMIN' } }, data: { role } });
    if (count !== 1) throw new ApiError(403, '관리자 계정의 역할은 바꿀 수 없습니다');

    if (role === 'REQUESTER') {
      const active = await tx.request.count({ where: { assigneeId: id, status: { not: STATUS.COMPLETED } } });
      if (active > 0) {
        // 예외를 던지면 위의 역할 변경도 함께 취소된다.
        throw new ApiError(
          409,
          `진행 중인 담당 요청서가 ${active}건 있어 지원자 지정을 해제할 수 없습니다. 요청서를 모두 완료한 뒤 해제해 주세요`
        );
      }
    }
    return tx.user.findUnique({ where: { id }, select: USER_SELECT });
  });
}

// ── 지원 유형 ────────────────────────────────────────────────

const toTypeView = (type) => ({
  id: type.id,
  name: type.name,
  active: type.active,
  sortOrder: type.sortOrder,
  requestCount: type._count?.requests ?? 0,
});

const DUPLICATE_NAME = '이미 같은 이름의 지원 유형이 있습니다';
const isUniqueViolation = (err) => err && err.code === 'P2002';

/** 사용 중이 아닌 유형까지 모두, 표시 순서대로. */
async function listSupportTypes() {
  const types = await prisma.supportType.findMany({
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { requests: true } } },
  });
  return types.map(toTypeView);
}

/** 새 유형은 맨 뒤에 붙는다. */
async function createSupportType({ name }) {
  const { _max } = await prisma.supportType.aggregate({ _max: { sortOrder: true } });
  try {
    const created = await prisma.supportType.create({
      data: { name, sortOrder: (_max.sortOrder ?? -1) + 1 },
      include: { _count: { select: { requests: true } } },
    });
    return toTypeView(created);
  } catch (err) {
    if (isUniqueViolation(err)) throw new ApiError(409, DUPLICATE_NAME, { name: DUPLICATE_NAME });
    throw err;
  }
}

/**
 * 이름·사용 여부·순서를 바꾼다. 유형은 삭제하지 않고 비활성화만 한다(이미 쓴 요청서가 참조하기 때문).
 * 사용 중인 유형이 하나도 남지 않게 되는 비활성화는 막는다(새 요청서를 만들 수 없게 되므로).
 */
async function updateSupportType(id, data) {
  const existing = await prisma.supportType.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, '지원 유형을 찾을 수 없습니다');

  try {
    return await prisma.$transaction(async (tx) => {
      await tx.supportType.update({ where: { id }, data });
      if (data.active === false && existing.active) {
        const stillActive = await tx.supportType.count({ where: { active: true } });
        if (stillActive === 0) {
          throw new ApiError(409, '사용 중인 지원 유형이 최소 1개는 있어야 합니다');
        }
      }
      const updated = await tx.supportType.findUnique({
        where: { id },
        include: { _count: { select: { requests: true } } },
      });
      return toTypeView(updated);
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ApiError(409, DUPLICATE_NAME, { name: DUPLICATE_NAME });
    throw err;
  }
}

module.exports = {
  listUsers,
  updateUserRole,
  listSupportTypes,
  createSupportType,
  updateSupportType,
};
