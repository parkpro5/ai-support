// vitest 는 ESM 전용이라 테스트 파일만 import 문법을 쓴다. 소스(CommonJS)는 기본 import 후 구조 분해한다.
import { describe, it, expect } from 'vitest';
import events from './notification.events.js';

const { buildNotification, resolveRecipients, shortTitle, MAX_TITLE_IN_BODY } = events;

const request = { id: 'req-1', title: '월간 보고서 자동화', requesterId: 'owner', assigneeId: 'assignee' };

describe('buildNotification: 누구에게 무엇을 알리는가', () => {
  it.each([
    ['SUBMIT', { roles: ['SUPPORTER'] }, '/requests'],
    ['ASSIGN', { userIds: ['assignee'] }, '/requests/req-1/work'],
    ['WORK_SUBMIT', { userIds: ['owner'] }, '/requests/req-1/review'],
    ['RESUBMIT', { userIds: ['owner'] }, '/requests/req-1/review'],
    ['FIRST_APPROVE', { roles: ['ADMIN'] }, '/requests/req-1/final-review'],
    ['FIRST_REJECT', { userIds: ['assignee'] }, '/requests/req-1/work'],
    ['FINAL_REJECT', { userIds: ['assignee'] }, '/requests/req-1/work'],
    ['FINAL_APPROVE', { userIds: ['owner', 'assignee'] }, '/requests/req-1'],
  ])('%s', (type, audience, url) => {
    const result = buildNotification(type, request);
    expect(result.audience).toEqual(audience);
    expect(result.payload.url).toBe(url);
    expect(result.payload.body).toBe('월간 보고서 자동화');
    expect(result.payload.title).toEqual(expect.any(String));
    expect(result.payload.title.length).toBeGreaterThan(0);
  });

  it('알림을 보내지 않는 이력은 null이다(접수, 접수 취소, 1차 승인 전 단계 등)', () => {
    for (const type of ['ACCEPT', 'CANCEL_ACCEPT', 'UNKNOWN', 'toString', '']) {
      expect(buildNotification(type, request), type).toBeNull();
    }
  });

  it('반려 알림은 모두 같은 문구로 재작업 화면을 연다', () => {
    const first = buildNotification('FIRST_REJECT', request);
    const final = buildNotification('FINAL_REJECT', request);
    expect(first.payload).toEqual(final.payload);
    expect(first.payload.title).toContain('반려');
  });

  it('담당자가 비어 있으면 대상 목록에서 빠진다(빈 값을 사용자 id로 쓰지 않는다)', () => {
    expect(buildNotification('FIRST_REJECT', { ...request, assigneeId: null }).audience).toEqual({ userIds: [] });
    expect(buildNotification('FINAL_APPROVE', { ...request, assigneeId: null }).audience).toEqual({ userIds: ['owner'] });
  });

  it('긴 제목은 본문에서 줄여 푸시 크기를 넘지 않게 한다', () => {
    const long = 'a'.repeat(300);
    const { payload } = buildNotification('SUBMIT', { ...request, title: long });
    expect(payload.body.length).toBe(MAX_TITLE_IN_BODY + 1); // 줄임표 한 글자 포함
    expect(payload.body.endsWith('…')).toBe(true);
    expect(JSON.stringify(payload).length).toBeLessThan(1000);
  });

  it('입력 객체를 바꾸지 않는다', () => {
    const snapshot = JSON.stringify(request);
    buildNotification('FINAL_APPROVE', request);
    expect(JSON.stringify(request)).toBe(snapshot);
  });
});

describe('shortTitle', () => {
  it('짧은 제목은 그대로, 앞뒤 공백은 제거', () => {
    expect(shortTitle('  제목  ')).toBe('제목');
  });

  it('경계 길이는 줄이지 않고 한 글자 넘으면 줄인다', () => {
    expect(shortTitle('가'.repeat(MAX_TITLE_IN_BODY))).toHaveLength(MAX_TITLE_IN_BODY);
    expect(shortTitle('가'.repeat(MAX_TITLE_IN_BODY + 1))).toHaveLength(MAX_TITLE_IN_BODY + 1);
    expect(shortTitle('가'.repeat(MAX_TITLE_IN_BODY + 1)).endsWith('…')).toBe(true);
  });

  it('값이 없으면 빈 문자열', () => {
    expect(shortTitle(undefined)).toBe('');
    expect(shortTitle(null)).toBe('');
  });
});

describe('resolveRecipients', () => {
  it('직접 지정한 사용자와 역할로 모은 사용자를 합치고 중복을 없앤다', () => {
    expect(resolveRecipients({ userIds: ['a', 'b'] }, ['b', 'c'], 'zzz').sort()).toEqual(['a', 'b', 'c']);
  });

  it('행동한 본인은 뺀다', () => {
    expect(resolveRecipients({ userIds: ['owner', 'assignee'] }, [], 'owner')).toEqual(['assignee']);
    expect(resolveRecipients({ roles: ['ADMIN'] }, ['admin1', 'admin2'], 'admin1')).toEqual(['admin2']);
  });

  it('대상이 없으면 빈 목록', () => {
    expect(resolveRecipients({}, [], 'x')).toEqual([]);
    expect(resolveRecipients({ userIds: ['x'] }, [], 'x')).toEqual([]);
  });
});
