// vitest 는 ESM 전용이라 테스트 파일만 import 문법을 쓴다. 소스(CommonJS)는 기본 import 후 구조 분해한다.
import { describe, it, expect } from 'vitest';
import schemas from './request.schemas.js';

const {
  createRequestSchema,
  updateRequestSchema,
  createWorkLogSchema,
  reviewDecisionSchema,
  assignRequestSchema,
  listRequestsQuerySchema,
  MAX_WORK_MINUTES,
  MAX_REASON_LENGTH,
} = schemas;

const TYPE_ID = '3f2b8a52-6f5c-4a43-9a6e-1d2f6b8f0a11';

function validBody(overrides = {}) {
  return {
    supportTypeId: TYPE_ID,
    title: '  보고서 자동화 요청  ',
    content: '월간 보고서를 자동으로 만들고 싶습니다.',
    department: '기획처',
    contactName: '홍길동',
    contactPhone: '010-1234-5678',
    interviewAt: '2026-11-20T10:00:00.000Z',
    desiredDate: '2026-12-01',
    urgency: 'HIGH',
    ...overrides,
  };
}

/** 항목별 오류 메시지를 { 필드: 메시지 } 로 모은다. */
function errorsOf(schema, input) {
  const result = schema.safeParse(input);
  if (result.success) return null;
  const errors = {};
  for (const issue of result.error.issues) {
    const field = issue.path.join('.') || '_';
    if (!(field in errors)) errors[field] = issue.message;
  }
  return errors;
}

describe('createRequestSchema', () => {
  it('올바른 입력은 통과하고 문자열은 앞뒤 공백이 제거된다', () => {
    const result = createRequestSchema.parse(validBody());
    expect(result.title).toBe('보고서 자동화 요청');
    expect(result.desiredDate).toBeInstanceOf(Date);
    expect(result.desiredDate.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(result.interviewAt).toBeInstanceOf(Date);
    expect(result.urgency).toBe('HIGH');
  });

  it('긴급도를 생략하면 NORMAL', () => {
    const { urgency, ...rest } = validBody();
    expect(createRequestSchema.parse(rest).urgency).toBe('NORMAL');
  });

  it('필수 항목이 비면 항목별 오류가 나온다', () => {
    const errors = errorsOf(
      createRequestSchema,
      validBody({ title: '', content: '   ', department: '', contactName: '', contactPhone: '' })
    );
    expect(Object.keys(errors).sort()).toEqual(['contactName', 'contactPhone', 'content', 'department', 'title']);
    expect(errors.title).toBe('제목 항목을 입력해 주세요');
  });

  it('항목이 아예 없어도 항목별 오류가 나온다', () => {
    const errors = errorsOf(createRequestSchema, {});
    expect(Object.keys(errors).sort()).toEqual([
      'contactName',
      'contactPhone',
      'content',
      'department',
      'desiredDate',
      'interviewAt',
      'supportTypeId',
      'title',
    ]);
  });

  it('지원 유형이 UUID가 아니면 거부', () => {
    expect(errorsOf(createRequestSchema, validBody({ supportTypeId: 'abc' }))).toHaveProperty('supportTypeId');
  });

  it('존재하지 않는 날짜와 형식이 다른 날짜는 거부', () => {
    expect(errorsOf(createRequestSchema, validBody({ desiredDate: '2026-02-30' }))).toHaveProperty('desiredDate');
    expect(errorsOf(createRequestSchema, validBody({ desiredDate: '2026/12/01' }))).toHaveProperty('desiredDate');
    expect(errorsOf(createRequestSchema, validBody({ desiredDate: '' }))).toHaveProperty('desiredDate');
  });

  it('착수(인터뷰) 일시가 날짜가 아니면 거부', () => {
    expect(errorsOf(createRequestSchema, validBody({ interviewAt: 'not-a-date' }))).toHaveProperty('interviewAt');
    expect(errorsOf(createRequestSchema, validBody({ interviewAt: '' }))).toHaveProperty('interviewAt');
  });

  it('연락처 형식과 길이를 검사한다', () => {
    expect(errorsOf(createRequestSchema, validBody({ contactPhone: 'abc-defg-hijk' }))).toHaveProperty('contactPhone');
    expect(errorsOf(createRequestSchema, validBody({ contactPhone: '123' }))).toHaveProperty('contactPhone');
    expect(errorsOf(createRequestSchema, validBody({ contactPhone: '02-123-4567' }))).toBeNull();
    expect(errorsOf(createRequestSchema, validBody({ contactPhone: '+82 10 1234 5678' }))).toBeNull();
  });

  it('알 수 없는 긴급도는 거부', () => {
    expect(errorsOf(createRequestSchema, validBody({ urgency: 'URGENT' }))).toHaveProperty('urgency');
  });

  it('길이 제한을 넘으면 거부', () => {
    expect(errorsOf(createRequestSchema, validBody({ title: 'a'.repeat(201) }))).toHaveProperty('title');
    expect(errorsOf(createRequestSchema, validBody({ content: 'a'.repeat(5001) }))).toHaveProperty('content');
  });

  it('상태·작성자 같은 서버가 정할 값은 입력으로 받지 않는다(버린다)', () => {
    const result = createRequestSchema.parse(
      validBody({ status: 'COMPLETED', requesterId: 'someone-else', assigneeId: 'x', completedAt: '2026-01-01' })
    );
    expect(result).not.toHaveProperty('status');
    expect(result).not.toHaveProperty('requesterId');
    expect(result).not.toHaveProperty('assigneeId');
    expect(result).not.toHaveProperty('completedAt');
  });
});

describe('updateRequestSchema', () => {
  it('바꿀 항목만 보내도 통과하고, 안 보낸 항목은 기본값으로 채워지지 않는다', () => {
    const result = updateRequestSchema.parse({ title: '새 제목' });
    expect(result).toEqual({ title: '새 제목' });
    expect(result).not.toHaveProperty('urgency');
  });

  it('빈 객체는 거부', () => {
    expect(errorsOf(updateRequestSchema, {})).not.toBeNull();
  });

  it('보낸 항목은 작성 때와 같은 규칙으로 검사한다', () => {
    expect(errorsOf(updateRequestSchema, { title: '' })).toHaveProperty('title');
    expect(errorsOf(updateRequestSchema, { desiredDate: '2026-13-01' })).toHaveProperty('desiredDate');
  });

  it('서버가 정할 값만 보내면 빈 수정으로 보고 거부', () => {
    expect(errorsOf(updateRequestSchema, { status: 'COMPLETED' })).not.toBeNull();
  });
});

describe('listRequestsQuerySchema', () => {
  it('기본값은 1페이지, 20건', () => {
    expect(listRequestsQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
  });

  it('쿼리 문자열 숫자를 정수로 바꾼다', () => {
    expect(listRequestsQuerySchema.parse({ page: '2', pageSize: '50', status: 'SUBMITTED', scope: 'mine' })).toEqual({
      page: 2,
      pageSize: 50,
      status: 'SUBMITTED',
      scope: 'mine',
    });
  });

  it('잘못된 값은 거부한다', () => {
    expect(errorsOf(listRequestsQuerySchema, { page: '0' })).toHaveProperty('page');
    expect(errorsOf(listRequestsQuerySchema, { pageSize: '101' })).toHaveProperty('pageSize');
    expect(errorsOf(listRequestsQuerySchema, { pageSize: '1.5' })).toHaveProperty('pageSize');
    expect(errorsOf(listRequestsQuerySchema, { status: 'DONE' })).toHaveProperty('status');
    expect(errorsOf(listRequestsQuerySchema, { scope: 'all' })).toHaveProperty('scope');
  });
});

describe('createWorkLogSchema', () => {
  it('올바른 입력은 통과하고 작업 내용은 앞뒤 공백이 제거된다', () => {
    expect(createWorkLogSchema.parse({ content: '  자동화 스크립트 작성  ', minutes: 90 })).toEqual({
      content: '자동화 스크립트 작성',
      minutes: 90,
    });
  });

  it('소요 시간 0분도 허용한다', () => {
    expect(createWorkLogSchema.parse({ content: '확인만 함', minutes: 0 }).minutes).toBe(0);
  });

  it('작업 내용이 비었거나 공백뿐이면 거부', () => {
    expect(errorsOf(createWorkLogSchema, { content: '', minutes: 10 })).toHaveProperty('content');
    expect(errorsOf(createWorkLogSchema, { content: '   ', minutes: 10 })).toHaveProperty('content');
    expect(errorsOf(createWorkLogSchema, { minutes: 10 })).toHaveProperty('content');
  });

  it('소요 시간이 없거나 숫자가 아니면 거부', () => {
    expect(errorsOf(createWorkLogSchema, { content: '작업' })).toHaveProperty('minutes');
    expect(errorsOf(createWorkLogSchema, { content: '작업', minutes: '30' })).toHaveProperty('minutes');
    expect(errorsOf(createWorkLogSchema, { content: '작업', minutes: null })).toHaveProperty('minutes');
    expect(errorsOf(createWorkLogSchema, { content: '작업', minutes: Number.NaN })).toHaveProperty('minutes');
  });

  it('소요 시간이 음수이거나 소수이면 거부', () => {
    expect(errorsOf(createWorkLogSchema, { content: '작업', minutes: -1 }).minutes).toMatch(/0 이상/);
    expect(errorsOf(createWorkLogSchema, { content: '작업', minutes: 1.5 }).minutes).toMatch(/정수/);
  });

  it('상한을 넘으면 거부하고 상한 값은 허용', () => {
    expect(errorsOf(createWorkLogSchema, { content: '작업', minutes: MAX_WORK_MINUTES + 1 })).toHaveProperty('minutes');
    expect(errorsOf(createWorkLogSchema, { content: '작업', minutes: MAX_WORK_MINUTES })).toBeNull();
  });

  it('길이 제한을 넘으면 거부', () => {
    expect(errorsOf(createWorkLogSchema, { content: 'a'.repeat(5001), minutes: 1 })).toHaveProperty('content');
  });

  it('작성자·회차 같은 서버가 정할 값은 입력으로 받지 않는다(버린다)', () => {
    const result = createWorkLogSchema.parse({ content: '작업', minutes: 5, authorId: 'x', round: 9, requestId: 'y' });
    expect(result).toEqual({ content: '작업', minutes: 5 });
  });
});

describe('reviewDecisionSchema', () => {
  it('승인은 사유 없이 통과한다', () => {
    expect(reviewDecisionSchema.parse({ decision: 'APPROVE' })).toEqual({ decision: 'APPROVE' });
  });

  it('승인에 사유를 보내도 버린다', () => {
    expect(reviewDecisionSchema.parse({ decision: 'APPROVE', reason: '무시됨' })).toEqual({ decision: 'APPROVE' });
  });

  it('반려는 사유가 있어야 통과하고 앞뒤 공백은 제거된다', () => {
    expect(reviewDecisionSchema.parse({ decision: 'REJECT', reason: '  내용 보완 필요  ' })).toEqual({
      decision: 'REJECT',
      reason: '내용 보완 필요',
    });
  });

  it.each([
    ['사유 없음', { decision: 'REJECT' }],
    ['빈 문자열', { decision: 'REJECT', reason: '' }],
    ['공백뿐', { decision: 'REJECT', reason: '   ' + String.fromCharCode(10) + ' ' }],
  ])('반려는 사유가 비어 있으면 reason 항목 오류 (%s)', (_name, input) => {
    expect(errorsOf(reviewDecisionSchema, input)).toEqual({ reason: '반려 사유를 입력해 주세요' });
  });

  it('반려 사유가 글자가 아니면 거부', () => {
    expect(errorsOf(reviewDecisionSchema, { decision: 'REJECT', reason: 123 })).toHaveProperty('reason');
  });

  it('사유 길이 상한을 넘으면 거부하고 상한 값은 허용', () => {
    expect(errorsOf(reviewDecisionSchema, { decision: 'REJECT', reason: 'a'.repeat(MAX_REASON_LENGTH + 1) })).toHaveProperty('reason');
    expect(errorsOf(reviewDecisionSchema, { decision: 'REJECT', reason: 'a'.repeat(MAX_REASON_LENGTH) })).toBeNull();
  });

  it('결정이 없거나 알 수 없으면 decision 항목 오류', () => {
    expect(errorsOf(reviewDecisionSchema, {})).toHaveProperty('decision');
    expect(errorsOf(reviewDecisionSchema, { decision: 'MAYBE' })).toHaveProperty('decision');
    expect(errorsOf(reviewDecisionSchema, { decision: 'approve' })).toHaveProperty('decision');
  });

  it('서버가 정할 값(상태 등)은 입력으로 받지 않는다(버린다)', () => {
    expect(reviewDecisionSchema.parse({ decision: 'APPROVE', status: 'COMPLETED', actorId: 'x' })).toEqual({
      decision: 'APPROVE',
    });
  });
});

describe('assignRequestSchema', () => {
  it('지원자 id가 있으면 통과하고 앞뒤 공백은 제거된다', () => {
    expect(assignRequestSchema.parse({ supporterId: '  abc  ' })).toEqual({ supporterId: 'abc' });
  });

  it('지원자 id가 없거나 비어 있거나 문자열이 아니면 supporterId 항목 오류', () => {
    for (const input of [{}, { supporterId: '' }, { supporterId: '   ' }, { supporterId: 123 }, { supporterId: null }]) {
      expect(errorsOf(assignRequestSchema, input), JSON.stringify(input)).toHaveProperty('supporterId');
    }
  });

  it('서버가 정할 값(상태, 담당자 등)은 입력으로 받지 않는다(버린다)', () => {
    expect(assignRequestSchema.parse({ supporterId: 'x', status: 'COMPLETED', assigneeId: 'y' })).toEqual({
      supporterId: 'x',
    });
  });
});
