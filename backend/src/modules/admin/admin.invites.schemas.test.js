// 지원자 이메일 사전 등록 입력 규칙(순수 검증).
import { describe, it, expect } from 'vitest';
import schemas from './admin.schemas.js';

const { registerSupportersSchema, MAX_INVITE_EMAILS } = schemas;

const parse = (emails) => registerSupportersSchema.safeParse({ emails });

describe('registerSupportersSchema', () => {
  it('앞뒤 공백을 지우고 소문자로 맞춘다', () => {
    const result = parse(['  Student.One@Example.COM  ']);
    expect(result.success).toBe(true);
    expect(result.data.emails).toEqual(['student.one@example.com']);
  });

  it('대소문자만 다른 같은 이메일은 하나로 합치고 처음 순서를 지킨다', () => {
    const result = parse(['b@example.com', 'A@example.com', 'B@EXAMPLE.com', 'a@example.com']);
    expect(result.data.emails).toEqual(['b@example.com', 'a@example.com']);
  });

  it('여러 개를 받는다', () => {
    const result = parse(['a@example.com', 'b@example.com', 'c@example.com']);
    expect(result.data.emails).toHaveLength(3);
  });

  it.each([
    ['@ 가 없음', 'plainaddress'],
    ['도메인 없음', 'user@'],
    ['아이디 없음', '@example.com'],
    ['공백이 가운데에 있음', 'us er@example.com'],
    ['표시 이름이 붙음', 'Kim <kim@example.com>'],
    ['쉼표로 이어 붙임', 'a@example.com,b@example.com'],
    ['빈 문자열', ''],
    ['공백뿐', '   '],
  ])('형식이 틀린 이메일은 거부: %s', (_name, value) => {
    const result = parse(['ok@example.com', value]);
    expect(result.success).toBe(false);
    // 어느 항목이 틀렸는지 알려 준다(첫 항목은 정상이므로 두 번째 항목의 경로여야 한다).
    expect(result.error.issues[0].path).toEqual(['emails', 1]);
  });

  it('하나라도 틀리면 전체를 거부한다(일부만 등록되는 혼란 방지)', () => {
    expect(parse(['a@example.com', 'b@example.com', 'nope']).success).toBe(false);
  });

  it('너무 긴 이메일은 거부', () => {
    expect(parse([`${'a'.repeat(250)}@example.com`]).success).toBe(false);
  });

  it('빈 목록은 거부', () => {
    const result = parse([]);
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toContain('한 개 이상');
  });

  it(`${MAX_INVITE_EMAILS}개까지는 되고 넘으면 거부`, () => {
    const make = (n) => Array.from({ length: n }, (_, i) => `student${i}@example.com`);
    expect(parse(make(MAX_INVITE_EMAILS)).success).toBe(true);
    expect(parse(make(MAX_INVITE_EMAILS + 1)).success).toBe(false);
  });

  it('배열이 아니거나 글자가 아닌 항목은 거부', () => {
    expect(registerSupportersSchema.safeParse({}).success).toBe(false);
    expect(registerSupportersSchema.safeParse({ emails: 'a@example.com' }).success).toBe(false);
    expect(registerSupportersSchema.safeParse({ emails: [123] }).success).toBe(false);
    expect(registerSupportersSchema.safeParse({ emails: [null] }).success).toBe(false);
  });
});
