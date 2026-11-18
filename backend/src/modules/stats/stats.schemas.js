const { z } = require('zod');
const { parseMonth } = require('./hours');
const { DEFAULT_PERIOD_MONTHS, MAX_PERIOD_MONTHS } = require('./dashboard');

/** 조회할 달. 없으면 이번 달(KST)이다. */
const hoursQuerySchema = z.object({
  month: z
    .string()
    .trim()
    .refine((value) => parseMonth(value) !== null, '월은 YYYY-MM 형식(예: 2026-11)으로 입력해 주세요')
    .optional(),
});

/**
 * 대시보드 조회 기간: 이번 달부터 거슬러 올라간 개월 수(1~24). 생략하면 6개월.
 * 쿼리 문자열이라 숫자 모양의 글자만 받는다("6", "06"은 되고 "6.5", "-1", "abc"는 안 된다).
 */
const periodQuerySchema = z.object({
  months: z
    .string()
    .trim()
    .regex(/^\d{1,3}$/, `기간은 1~${MAX_PERIOD_MONTHS} 사이의 개월 수로 입력해 주세요`)
    .transform(Number)
    .refine((value) => value >= 1 && value <= MAX_PERIOD_MONTHS, `기간은 1~${MAX_PERIOD_MONTHS} 사이의 개월 수로 입력해 주세요`)
    .default(String(DEFAULT_PERIOD_MONTHS)),
});

module.exports = { hoursQuerySchema, periodQuerySchema };
