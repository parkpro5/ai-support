const { z } = require('zod');
const { STATUS } = require('./stateMachine');

const URGENCIES = ['LOW', 'NORMAL', 'HIGH'];
const MAX_PAGE_SIZE = 100;
/** 만족도 후기(한 줄) 길이 상한. */
const MAX_RATING_COMMENT_LENGTH = 200;
/** 소요 시간 상한(분). 약 166시간. 숫자를 잘못 눌러 터무니없는 값이 들어가는 것을 막는다. */
const MAX_WORK_MINUTES = 10000;
/** 반려 사유 길이 상한. */
const MAX_REASON_LENGTH = 2000;

/** 공백만 있는 값은 비어 있는 것으로 본다. */
function requiredText(label, max) {
  return z
    .string({ required_error: `${label} 항목을 입력해 주세요`, invalid_type_error: `${label} 항목을 입력해 주세요` })
    .trim()
    .min(1, `${label} 항목을 입력해 주세요`)
    .max(max, `${label} 항목은 ${max}자 이하로 입력해 주세요`);
}

const dateTimeField = z.coerce.date({
  errorMap: () => ({ message: '착수(인터뷰) 일시를 올바르게 입력하세요' }),
});

// DB의 @db.Date 에 맞춰 'YYYY-MM-DD' 만 받는다. 존재하지 않는 날짜(2026-02-30)는 거부한다.
const dateOnlyField = z
  .string({ required_error: '희망 완료일을 입력하세요', invalid_type_error: '희망 완료일을 입력하세요' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, '희망 완료일을 올바르게 입력하세요')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, '희망 완료일을 올바르게 입력하세요')
  .transform((value) => new Date(`${value}T00:00:00.000Z`));

const requestFields = {
  supportTypeId: z
    .string({ required_error: '지원 유형을 선택하세요', invalid_type_error: '지원 유형을 선택하세요' })
    .uuid('지원 유형을 선택하세요'),
  title: requiredText('제목', 200),
  content: requiredText('요청 내용', 5000),
  department: requiredText('소속', 100),
  contactName: requiredText('담당자', 50),
  contactPhone: requiredText('연락처', 30).regex(/^[0-9+\-\s()]{7,30}$/, '연락처를 올바르게 입력하세요'),
  interviewAt: dateTimeField,
  desiredDate: dateOnlyField,
  urgency: z.enum(URGENCIES, { errorMap: () => ({ message: '긴급도를 선택하세요' }) }).default('NORMAL'),
};

/** 요청서 작성(제출). 정의되지 않은 키(status, requesterId 등)는 버린다. */
const createRequestSchema = z.object(requestFields);

/** 요청서 수정. 바꿀 항목만 보낼 수 있고, 최소 하나는 있어야 한다. */
const updateRequestSchema = z
  .object(requestFields)
  .partial()
  .refine((data) => Object.keys(data).length > 0, '수정할 항목이 없습니다');

/** 작업내역 제출. 담당 지원자가 작업 내용과 소요 시간(분)을 입력한다. */
const createWorkLogSchema = z.object({
  content: requiredText('작업 내용', 5000),
  minutes: z
    .number({
      required_error: '소요 시간(분)을 입력해 주세요',
      invalid_type_error: '소요 시간(분)은 숫자로 입력해 주세요',
    })
    .int('소요 시간(분)은 정수로 입력해 주세요')
    .min(0, '소요 시간(분)은 0 이상이어야 합니다')
    .max(MAX_WORK_MINUTES, `소요 시간(분)은 ${MAX_WORK_MINUTES}분 이하로 입력해 주세요`),
});

/**
 * 확인(승인·반려) 요청. 반려(REJECT)에는 사유가 필수이고, 승인(APPROVE)이면 사유는 버린다.
 * 1차 확인(요청자)과 최종 확인(관리자, T-10)이 같은 형식을 쓴다.
 */
const reviewDecisionSchema = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT'], {
      errorMap: () => ({ message: '승인 또는 반려를 선택해 주세요' }),
    }),
    reason: z
      .string({ invalid_type_error: '반려 사유는 글자로 입력해 주세요' })
      .trim()
      .max(MAX_REASON_LENGTH, `반려 사유는 ${MAX_REASON_LENGTH}자 이하로 입력해 주세요`)
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (data.decision === 'REJECT' && !data.reason) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reason'], message: '반려 사유를 입력해 주세요' });
    }
  })
  .transform((data) => (data.decision === 'APPROVE' ? { decision: 'APPROVE' } : data));

/**
 * 만족도 평가. 1~5점 정수와 한 줄 후기(선택).
 * 후기는 줄바꿈 없이 한 줄만 받고, 비어 있으면 후기 없음(null)으로 저장한다.
 */
const ratingSchema = z.object({
  score: z
    .number({
      required_error: '점수를 선택해 주세요',
      invalid_type_error: '점수는 숫자로 입력해 주세요',
    })
    .int('점수는 정수로 입력해 주세요')
    .min(1, '점수는 1점 이상이어야 합니다')
    .max(5, '점수는 5점 이하여야 합니다'),
  comment: z
    .string({ invalid_type_error: '후기는 글자로 입력해 주세요' })
    .trim()
    .max(MAX_RATING_COMMENT_LENGTH, `후기는 ${MAX_RATING_COMMENT_LENGTH}자 이하로 입력해 주세요`)
    .refine((value) => !/[\r\n]/.test(value), '후기는 한 줄로 입력해 주세요')
    .nullish()
    .transform((value) => value || null),
});

/** 관리자가 제출됨 요청서를 지원자에게 배정한다. 어떤 지원자인지만 받는다. */
const assignRequestSchema = z.object({
  supporterId: z
    .string({ required_error: '배정할 지원자를 선택해 주세요', invalid_type_error: '배정할 지원자를 선택해 주세요' })
    .trim()
    .min(1, '배정할 지원자를 선택해 주세요'),
});

const listRequestsQuerySchema = z.object({
  status: z.enum(Object.values(STATUS), { errorMap: () => ({ message: '알 수 없는 상태입니다' }) }).optional(),
  // 지원자 전용: available(접수 가능), mine(내 담당). 다른 역할에서는 무시한다.
  scope: z.enum(['available', 'mine'], { errorMap: () => ({ message: '알 수 없는 범위입니다' }) }).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
});

module.exports = {
  createRequestSchema,
  updateRequestSchema,
  createWorkLogSchema,
  reviewDecisionSchema,
  ratingSchema,
  assignRequestSchema,
  listRequestsQuerySchema,
  MAX_PAGE_SIZE,
  MAX_RATING_COMMENT_LENGTH,
  MAX_WORK_MINUTES,
  MAX_REASON_LENGTH,
};
