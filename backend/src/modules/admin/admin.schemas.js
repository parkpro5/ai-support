const { z } = require('zod');

const MAX_PAGE_SIZE = 100;
const MAX_TYPE_NAME_LENGTH = 50;
const MAX_SORT_ORDER = 9999;

const listUsersQuerySchema = z.object({
  role: z.enum(['REQUESTER', 'SUPPORTER', 'ADMIN'], { errorMap: () => ({ message: '알 수 없는 역할입니다' }) }).optional(),
  // 이름 또는 이메일의 일부. 앞뒤 공백은 무시하고 빈 값이면 검색하지 않는다.
  q: z
    .string()
    .trim()
    .max(100, '검색어는 100자 이하로 입력해 주세요')
    .optional()
    .transform((value) => value || undefined),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
});

/** 관리자는 일반 사용자를 요청자 또는 지원자로만 바꿀 수 있다. 관리자 역할은 지정할 수 없다. */
const updateUserRoleSchema = z.object({
  role: z.enum(['REQUESTER', 'SUPPORTER'], {
    errorMap: () => ({ message: '요청자 또는 지원자만 지정할 수 있습니다' }),
  }),
});

const typeName = z
  .string({ required_error: '이름을 입력해 주세요', invalid_type_error: '이름을 입력해 주세요' })
  .trim()
  .min(1, '이름을 입력해 주세요')
  .max(MAX_TYPE_NAME_LENGTH, `이름은 ${MAX_TYPE_NAME_LENGTH}자 이하로 입력해 주세요`);

const createSupportTypeSchema = z.object({ name: typeName });

/** 이름 변경, 사용 여부(삭제 대신 비활성화), 표시 순서. 바꿀 항목은 최소 하나 있어야 한다. */
const updateSupportTypeSchema = z
  .object({
    name: typeName,
    active: z.boolean({ invalid_type_error: '사용 여부는 true 또는 false여야 합니다' }),
    sortOrder: z
      .number({ invalid_type_error: '순서는 숫자여야 합니다' })
      .int('순서는 정수여야 합니다')
      .min(0, '순서는 0 이상이어야 합니다')
      .max(MAX_SORT_ORDER, `순서는 ${MAX_SORT_ORDER} 이하여야 합니다`),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, '수정할 항목이 없습니다');

module.exports = {
  listUsersQuerySchema,
  updateUserRoleSchema,
  createSupportTypeSchema,
  updateSupportTypeSchema,
  MAX_TYPE_NAME_LENGTH,
};
