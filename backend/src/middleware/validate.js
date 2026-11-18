const ApiError = require('../utils/ApiError');

/**
 * zod 스키마로 요청 입력을 검증하고 통과한 값으로 교체한다.
 * 실패하면 400과 함께 항목(필드)별 메시지(details)를 돌려준다.
 * @param {import('zod').ZodTypeAny} schema
 * @param {'body'|'query'} [source='body']
 */
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const issues = result.error.issues;
      const message = issues.map((i) => i.message).join(', ');
      const details = {};
      for (const issue of issues) {
        const field = issue.path.length > 0 ? issue.path.join('.') : '_';
        if (!(field in details)) details[field] = issue.message;
      }
      return next(new ApiError(400, message, details));
    }
    req[source] = result.data;
    next();
  };
}

module.exports = validate;
