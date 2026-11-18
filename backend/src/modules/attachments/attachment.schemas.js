const { z } = require('zod');

const target = z.enum(['request', 'work'], {
  errorMap: () => ({ message: '첨부 대상은 request 또는 work여야 합니다' }),
});

const fileName = z
  .string({ required_error: '파일 이름을 입력해 주세요', invalid_type_error: '파일 이름을 입력해 주세요' })
  .max(255, '파일 이름이 너무 깁니다');

/** 업로드 주소 요청. 파일 형식·크기 검사는 규칙(attachment.rules)에서 하고, 여기서는 값의 모양만 본다. */
const uploadUrlSchema = z.object({
  target,
  fileName,
  size: z.number({ required_error: '파일 크기를 알려 주세요', invalid_type_error: '파일 크기는 숫자여야 합니다' }),
});

/** 업로드를 마친 파일의 등록. 크기는 받지 않는다(서버가 저장소에서 실제 크기를 읽는다). */
const registerAttachmentSchema = z.object({
  target,
  path: z.string({ required_error: '파일 경로가 없습니다', invalid_type_error: '파일 경로가 없습니다' }).min(1, '파일 경로가 없습니다').max(300),
  fileName,
});

module.exports = { uploadUrlSchema, registerAttachmentSchema };
