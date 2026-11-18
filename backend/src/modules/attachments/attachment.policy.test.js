// vitest 는 ESM 전용이라 테스트 파일만 import 문법을 쓴다. 소스(CommonJS)는 기본 import 후 구조 분해한다.
import { describe, it, expect } from 'vitest';
import policy from './attachment.policy.js';
import storage from './storage.service.js';

const { TARGETS, canAttach, kindOf, canSeeAttachment, canDeleteAttachment, toAttachmentView } = policy;
const { isConfigured, isNotFound } = storage;

const owner = { id: 'owner', role: 'REQUESTER' };
const other = { id: 'other', role: 'REQUESTER' };
const assignee = { id: 'assignee', role: 'SUPPORTER' };
const otherSupporter = { id: 'other-sup', role: 'SUPPORTER' };
const admin = { id: 'admin', role: 'ADMIN' };

const makeRequest = (status, overrides = {}) => ({ id: 'r1', status, requesterId: 'owner', assigneeId: 'assignee', ...overrides });

// 첨부 종류별 예시
const requestFile = { id: 'a1', uploaderId: 'owner', workLogId: null, storagePath: 'secret/path.pdf', fileName: '요청.pdf', size: 10, mime: 'application/pdf', createdAt: new Date(0) };
const pendingFile = { ...requestFile, id: 'a2', uploaderId: 'assignee' }; // 제출 전 임시 작업내역 첨부
const workFile = { ...pendingFile, id: 'a3', workLogId: 'w1' }; // 제출된 작업내역에 묶인 첨부

describe('canAttach: 요청서 첨부', () => {
  it('작성자만, 제출됨 상태에서만', () => {
    expect(canAttach(owner, makeRequest('SUBMITTED'), TARGETS.REQUEST)).toBe(true);
    expect(canAttach(other, makeRequest('SUBMITTED'), TARGETS.REQUEST)).toBe(false);
    expect(canAttach(admin, makeRequest('SUBMITTED'), TARGETS.REQUEST)).toBe(false);
    expect(canAttach(assignee, makeRequest('SUBMITTED'), TARGETS.REQUEST)).toBe(false);
    for (const status of ['ACCEPTED', 'FIRST_REVIEW', 'FINAL_REVIEW', 'REWORK', 'COMPLETED']) {
      expect(canAttach(owner, makeRequest(status), TARGETS.REQUEST), status).toBe(false);
    }
  });

  it('관리자가 작성한 요청서는 그 관리자가 첨부할 수 있다', () => {
    expect(canAttach(admin, makeRequest('SUBMITTED', { requesterId: 'admin' }), TARGETS.REQUEST)).toBe(true);
  });
});

describe('canAttach: 작업내역 첨부', () => {
  it('담당 지원자만, 접수됨·재작업 상태에서만', () => {
    for (const status of ['ACCEPTED', 'REWORK']) {
      expect(canAttach(assignee, makeRequest(status), TARGETS.WORK), status).toBe(true);
      expect(canAttach(otherSupporter, makeRequest(status), TARGETS.WORK), status).toBe(false);
      expect(canAttach(owner, makeRequest(status), TARGETS.WORK), status).toBe(false);
      expect(canAttach(admin, makeRequest(status), TARGETS.WORK), status).toBe(false);
    }
    for (const status of ['SUBMITTED', 'FIRST_REVIEW', 'FINAL_REVIEW', 'COMPLETED']) {
      expect(canAttach(assignee, makeRequest(status), TARGETS.WORK), status).toBe(false);
    }
  });

  it('담당자가 없거나 역할이 지원자가 아니면 불가', () => {
    expect(canAttach(assignee, makeRequest('ACCEPTED', { assigneeId: null }), TARGETS.WORK)).toBe(false);
    expect(canAttach({ id: 'assignee', role: 'REQUESTER' }, makeRequest('ACCEPTED'), TARGETS.WORK)).toBe(false);
  });

  it('알 수 없는 대상은 불가', () => {
    expect(canAttach(owner, makeRequest('SUBMITTED'), 'other')).toBe(false);
  });
});

describe('kindOf', () => {
  const request = makeRequest('ACCEPTED');
  it('작업내역에 묶였으면 work, 작성자가 올렸으면 request, 그 외 묶이지 않은 것은 pendingWork', () => {
    expect(kindOf(workFile, request)).toBe('work');
    expect(kindOf(requestFile, request)).toBe('request');
    expect(kindOf(pendingFile, request)).toBe('pendingWork');
  });
});

describe('canSeeAttachment', () => {
  const request = makeRequest('FIRST_REVIEW');

  it('요청서 첨부와 제출된 작업내역 첨부는 작성자·담당 지원자·관리자가 본다', () => {
    for (const viewer of [owner, assignee, admin]) {
      expect(canSeeAttachment(viewer, request, requestFile), viewer.id).toBe(true);
      expect(canSeeAttachment(viewer, request, workFile), viewer.id).toBe(true);
    }
  });

  it('관련 없는 사용자는 모두 볼 수 없다', () => {
    for (const viewer of [other, otherSupporter]) {
      for (const file of [requestFile, workFile, pendingFile]) {
        expect(canSeeAttachment(viewer, request, file), `${viewer.id}/${file.id}`).toBe(false);
      }
    }
  });

  it('제출 전 임시 작업내역 첨부는 올린 본인만 본다(작성자·관리자에게도 숨김)', () => {
    expect(canSeeAttachment(assignee, request, pendingFile)).toBe(true);
    expect(canSeeAttachment(owner, request, pendingFile)).toBe(false);
    expect(canSeeAttachment(admin, request, pendingFile)).toBe(false);
  });

  it('아직 담당자가 없는 제출됨 요청서의 첨부는 접수하려는 지원자에게도 보이지 않는다', () => {
    const submitted = makeRequest('SUBMITTED', { assigneeId: null });
    expect(canSeeAttachment(otherSupporter, submitted, requestFile)).toBe(false);
    expect(canSeeAttachment(owner, submitted, requestFile)).toBe(true);
  });
});

describe('canDeleteAttachment', () => {
  it('요청서 첨부는 올린 작성자가 제출됨 상태에서만 지울 수 있다', () => {
    expect(canDeleteAttachment(owner, makeRequest('SUBMITTED'), requestFile)).toBe(true);
    expect(canDeleteAttachment(owner, makeRequest('ACCEPTED'), requestFile)).toBe(false);
    expect(canDeleteAttachment(admin, makeRequest('SUBMITTED'), requestFile)).toBe(false);
    expect(canDeleteAttachment(other, makeRequest('SUBMITTED'), requestFile)).toBe(false);
  });

  it('제출 전 임시 작업내역 첨부는 올린 지원자가 접수됨·재작업 상태에서만 지울 수 있다', () => {
    expect(canDeleteAttachment(assignee, makeRequest('ACCEPTED'), pendingFile)).toBe(true);
    expect(canDeleteAttachment(assignee, makeRequest('REWORK'), pendingFile)).toBe(true);
    expect(canDeleteAttachment(assignee, makeRequest('FIRST_REVIEW'), pendingFile)).toBe(false);
    expect(canDeleteAttachment(otherSupporter, makeRequest('ACCEPTED'), pendingFile)).toBe(false);
  });

  it('제출된 작업내역에 묶인 첨부는 누구도 지울 수 없다', () => {
    for (const user of [assignee, owner, admin]) {
      expect(canDeleteAttachment(user, makeRequest('REWORK'), workFile), user.id).toBe(false);
    }
  });
});

describe('toAttachmentView', () => {
  it('저장소 경로 같은 내부 값은 내보내지 않는다', () => {
    const view = toAttachmentView({ ...requestFile, uploader: { id: 'owner', name: '직원', email: 'x@y.z' } }, makeRequest('SUBMITTED'));
    expect(Object.keys(view).sort()).toEqual(['createdAt', 'fileName', 'id', 'kind', 'mime', 'size', 'uploader', 'workLogId']);
    expect(JSON.stringify(view)).not.toContain('secret/path');
    expect(view.uploader).toEqual({ id: 'owner', name: '직원' });
  });

  it('종류와 묶인 작업내역을 알려 준다', () => {
    const request = makeRequest('FIRST_REVIEW');
    expect(toAttachmentView(workFile, request)).toMatchObject({ kind: 'work', workLogId: 'w1' });
    expect(toAttachmentView(requestFile, request)).toMatchObject({ kind: 'request', workLogId: null });
  });
});

describe('storage.service 도우미', () => {
  it('isConfigured: 주소와 키가 모두 실제 값일 때만 true', () => {
    expect(isConfigured({ SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'real-key' })).toBe(true);
    expect(isConfigured({ SUPABASE_URL: 'http://localhost:54321', SUPABASE_SERVICE_ROLE_KEY: 'k' })).toBe(true);
  });

  it.each([
    ['둘 다 없음', {}],
    ['빈 값', { SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' }],
    ['키가 자리표시 값', { SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'your-service-role-key' }],
    ['키 없음', { SUPABASE_URL: 'https://abc.supabase.co' }],
    ['주소 없음', { SUPABASE_SERVICE_ROLE_KEY: 'real-key' }],
    ['주소 형식 오류', { SUPABASE_URL: 'not a url', SUPABASE_SERVICE_ROLE_KEY: 'real-key' }],
    ['http가 아닌 주소', { SUPABASE_URL: 'ftp://abc.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'real-key' }],
    ['공백뿐인 키', { SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_SERVICE_ROLE_KEY: '   ' }],
  ])('isConfigured: %s이면 false', (_name, config) => {
    expect(isConfigured(config)).toBe(false);
  });

  it('isNotFound: 404와 "not found" 계열 오류를 없는 파일로 본다', () => {
    expect(isNotFound({ status: 404 })).toBe(true);
    expect(isNotFound({ statusCode: '404' })).toBe(true);
    expect(isNotFound({ message: 'Object not found' })).toBe(true);
    expect(isNotFound({ code: 'NoSuchKey' })).toBe(true);
  });

  it('isNotFound: 그 밖의 오류(권한, 서버 오류, 네트워크)는 없는 파일로 보지 않는다', () => {
    expect(isNotFound({ status: 500, message: 'Internal error' })).toBe(false);
    expect(isNotFound({ status: 403, message: 'forbidden' })).toBe(false);
    expect(isNotFound({ message: 'fetch failed' })).toBe(false);
    expect(isNotFound(null)).toBe(false);
    expect(isNotFound(undefined)).toBe(false);
  });
});
