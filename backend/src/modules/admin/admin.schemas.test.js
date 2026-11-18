// vitest 는 ESM 전용이라 테스트 파일만 import 문법을 쓴다. 소스(CommonJS)는 기본 import 후 구조 분해한다.
import { describe, it, expect } from 'vitest';
import schemas from './admin.schemas.js';

const { listUsersQuerySchema, updateUserRoleSchema, createSupportTypeSchema, updateSupportTypeSchema, MAX_TYPE_NAME_LENGTH } =
  schemas;

/** 항목별 오류 메시지를 { 필드: 메시지 } 로 모은다. 통과하면 null. */
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

describe('listUsersQuerySchema', () => {
  it('기본값은 1페이지 20건', () => {
    expect(listUsersQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
  });

  it('역할과 검색어를 받고 검색어 앞뒤 공백은 제거한다', () => {
    expect(listUsersQuerySchema.parse({ role: 'SUPPORTER', q: '  홍길동 ', page: '2', pageSize: '50' })).toEqual({
      role: 'SUPPORTER',
      q: '홍길동',
      page: 2,
      pageSize: 50,
    });
  });

  it('공백뿐인 검색어는 검색하지 않는 것으로 본다', () => {
    expect(listUsersQuerySchema.parse({ q: '   ' }).q).toBeUndefined();
  });

  it('알 수 없는 역할, 너무 긴 검색어, 범위를 벗어난 페이지는 거부', () => {
    expect(errorsOf(listUsersQuerySchema, { role: 'ROOT' })).toHaveProperty('role');
    expect(errorsOf(listUsersQuerySchema, { q: 'a'.repeat(101) })).toHaveProperty('q');
    expect(errorsOf(listUsersQuerySchema, { page: '0' })).toHaveProperty('page');
    expect(errorsOf(listUsersQuerySchema, { pageSize: '101' })).toHaveProperty('pageSize');
  });
});

describe('updateUserRoleSchema', () => {
  it('요청자와 지원자만 지정할 수 있다', () => {
    expect(updateUserRoleSchema.parse({ role: 'SUPPORTER' })).toEqual({ role: 'SUPPORTER' });
    expect(updateUserRoleSchema.parse({ role: 'REQUESTER' })).toEqual({ role: 'REQUESTER' });
  });

  it('관리자 역할은 지정할 수 없고 값이 없거나 소문자여도 거부', () => {
    for (const input of [{ role: 'ADMIN' }, {}, { role: 'supporter' }, { role: '' }, { role: null }]) {
      expect(errorsOf(updateUserRoleSchema, input), JSON.stringify(input)).toHaveProperty('role');
    }
  });
});

describe('지원 유형 스키마', () => {
  it('이름은 앞뒤 공백을 제거해 받는다', () => {
    expect(createSupportTypeSchema.parse({ name: '  데이터 분석  ' })).toEqual({ name: '데이터 분석' });
  });

  it('이름이 없거나 공백뿐이거나 길면 거부', () => {
    expect(errorsOf(createSupportTypeSchema, {})).toHaveProperty('name');
    expect(errorsOf(createSupportTypeSchema, { name: '   ' })).toHaveProperty('name');
    expect(errorsOf(createSupportTypeSchema, { name: 'a'.repeat(MAX_TYPE_NAME_LENGTH + 1) })).toHaveProperty('name');
    expect(errorsOf(createSupportTypeSchema, { name: 'a'.repeat(MAX_TYPE_NAME_LENGTH) })).toBeNull();
  });

  it('수정은 바꿀 항목만 보낼 수 있다', () => {
    expect(updateSupportTypeSchema.parse({ active: false })).toEqual({ active: false });
    expect(updateSupportTypeSchema.parse({ name: ' 새 이름 ', sortOrder: 3 })).toEqual({ name: '새 이름', sortOrder: 3 });
  });

  it('수정할 항목이 하나도 없으면 거부(서버가 정할 값만 보낸 경우 포함)', () => {
    expect(errorsOf(updateSupportTypeSchema, {})).not.toBeNull();
    expect(errorsOf(updateSupportTypeSchema, { id: 'x', requestCount: 3 })).not.toBeNull();
  });

  it('사용 여부는 불리언만, 순서는 0 이상의 정수만 허용', () => {
    expect(errorsOf(updateSupportTypeSchema, { active: 'false' })).toHaveProperty('active');
    expect(errorsOf(updateSupportTypeSchema, { active: 0 })).toHaveProperty('active');
    expect(errorsOf(updateSupportTypeSchema, { sortOrder: -1 })).toHaveProperty('sortOrder');
    expect(errorsOf(updateSupportTypeSchema, { sortOrder: 1.5 })).toHaveProperty('sortOrder');
    expect(errorsOf(updateSupportTypeSchema, { sortOrder: '2' })).toHaveProperty('sortOrder');
  });
});
