// vitest 는 ESM 전용이라 테스트 파일만 import 문법을 쓴다. 소스(CommonJS)는 기본 import 후 구조 분해한다.
import { describe, it, expect } from 'vitest';
import policy from './request.policy.js';

const {
  buildListWhere,
  canViewRequest,
  canSeeContactPhone,
  canEditRequest,
  canAcceptRequest,
  canCancelAcceptRequest,
  canSubmitWorkLog,
  canFirstReviewRequest,
  canFinalReviewRequest,
  canAssignRequest,
  toRequestView,
} = policy;

const owner = { id: 'owner', role: 'REQUESTER' };
const other = { id: 'other', role: 'REQUESTER' };
const assignee = { id: 'assignee', role: 'SUPPORTER' };
const supporter = { id: 'supporter', role: 'SUPPORTER' };
const admin = { id: 'admin', role: 'ADMIN' };

function makeRequest(overrides = {}) {
  return {
    id: 'r1',
    title: '제목',
    content: '내용',
    status: 'SUBMITTED',
    urgency: 'NORMAL',
    department: '기획처',
    contactName: '홍길동',
    contactPhone: '010-1234-5678',
    interviewAt: new Date('2026-11-20T01:00:00.000Z'),
    desiredDate: new Date('2026-12-01T00:00:00.000Z'),
    requesterId: owner.id,
    assigneeId: null,
    supportType: { id: 't1', name: '업무 자동화' },
    requester: { id: owner.id, name: '직원' },
    assignee: null,
    createdAt: new Date('2026-11-17T00:00:00.000Z'),
    updatedAt: new Date('2026-11-17T00:00:00.000Z'),
    completedAt: null,
    ...overrides,
  };
}

describe('buildListWhere: 역할별 조회 범위', () => {
  it('요청자는 본인이 작성한 요청서만', () => {
    expect(buildListWhere(owner)).toEqual({ requesterId: 'owner' });
  });

  it('요청자는 scope를 보내도 범위가 넓어지지 않는다', () => {
    expect(buildListWhere(owner, { scope: 'available' })).toEqual({ requesterId: 'owner' });
  });

  it('지원자는 기본으로 접수 가능(제출됨)만', () => {
    expect(buildListWhere(supporter)).toEqual({ status: 'SUBMITTED' });
    expect(buildListWhere(supporter, { scope: 'available' })).toEqual({ status: 'SUBMITTED' });
  });

  it('지원자의 mine은 본인이 담당하는 요청서', () => {
    expect(buildListWhere(supporter, { scope: 'mine' })).toEqual({ assigneeId: 'supporter' });
  });

  it('관리자는 전체', () => {
    expect(buildListWhere(admin)).toEqual({});
  });

  it('상태 필터는 역할 범위에 AND로 걸린다(범위를 넓히지 못한다)', () => {
    expect(buildListWhere(owner, { status: 'COMPLETED' })).toEqual({
      AND: [{ requesterId: 'owner' }, { status: 'COMPLETED' }],
    });
    expect(buildListWhere(supporter, { status: 'COMPLETED' })).toEqual({
      AND: [{ status: 'SUBMITTED' }, { status: 'COMPLETED' }],
    });
  });
});

describe('canViewRequest: 단건 조회 권한은 목록 범위와 같다', () => {
  it('작성자와 관리자는 볼 수 있고 다른 요청자는 볼 수 없다', () => {
    expect(canViewRequest(owner, makeRequest())).toBe(true);
    expect(canViewRequest(admin, makeRequest())).toBe(true);
    expect(canViewRequest(other, makeRequest())).toBe(false);
  });

  it('지원자는 제출됨 요청서와 본인 담당 요청서만 볼 수 있다', () => {
    expect(canViewRequest(supporter, makeRequest({ status: 'SUBMITTED' }))).toBe(true);
    expect(canViewRequest(supporter, makeRequest({ status: 'ACCEPTED', assigneeId: 'assignee' }))).toBe(false);
    expect(canViewRequest(assignee, makeRequest({ status: 'ACCEPTED', assigneeId: 'assignee' }))).toBe(true);
    expect(canViewRequest(assignee, makeRequest({ status: 'COMPLETED', assigneeId: 'assignee' }))).toBe(true);
  });
});

describe('연락처 노출', () => {
  it('작성자, 담당 지원자, 관리자만 볼 수 있다', () => {
    const accepted = makeRequest({ status: 'ACCEPTED', assigneeId: 'assignee' });
    expect(canSeeContactPhone(owner, accepted)).toBe(true);
    expect(canSeeContactPhone(assignee, accepted)).toBe(true);
    expect(canSeeContactPhone(admin, accepted)).toBe(true);
    expect(canSeeContactPhone(supporter, accepted)).toBe(false);
    expect(canSeeContactPhone(other, accepted)).toBe(false);
  });

  it('담당자가 없는 요청서에서 지원자는 연락처를 볼 수 없다', () => {
    expect(canSeeContactPhone(supporter, makeRequest())).toBe(false);
  });

  it('상세 응답에서 권한 없는 사용자에게는 contactPhone이 null이다', () => {
    const request = makeRequest();
    expect(toRequestView(request, supporter, { detail: true }).contactPhone).toBeNull();
    expect(toRequestView(request, owner, { detail: true }).contactPhone).toBe('010-1234-5678');
  });
});

describe('toRequestView', () => {
  it('목록용 응답에는 본문과 연락처가 들어 있지 않다', () => {
    const view = toRequestView(makeRequest(), owner);
    expect(view).not.toHaveProperty('content');
    expect(view).not.toHaveProperty('contactPhone');
    expect(view).not.toHaveProperty('contactName');
    expect(view.desiredDate).toBe('2026-12-01');
    expect(view.supportType).toEqual({ id: 't1', name: '업무 자동화' });
  });

  it('상세 응답에는 본문과 담당자 이름이 들어 있다', () => {
    const view = toRequestView(makeRequest(), owner, { detail: true });
    expect(view.content).toBe('내용');
    expect(view.contactName).toBe('홍길동');
  });

  it('내부 식별자(requesterId 등) 대신 이름이 있는 객체로만 노출한다', () => {
    const view = toRequestView(makeRequest(), owner);
    expect(view).not.toHaveProperty('requesterId');
    expect(view).not.toHaveProperty('assigneeId');
    expect(view.requester).toEqual({ id: 'owner', name: '직원' });
  });
});

describe('canEditRequest', () => {
  it('작성자이고 제출됨 상태일 때만 수정할 수 있다', () => {
    expect(canEditRequest(owner, makeRequest())).toBe(true);
    expect(canEditRequest(owner, makeRequest({ status: 'ACCEPTED' }))).toBe(false);
    expect(canEditRequest(other, makeRequest())).toBe(false);
    expect(canEditRequest(admin, makeRequest())).toBe(false);
  });

  it('응답의 canEdit에 반영된다', () => {
    expect(toRequestView(makeRequest(), owner).canEdit).toBe(true);
    expect(toRequestView(makeRequest(), admin).canEdit).toBe(false);
  });
});

describe('접수·접수 취소 표시 조건', () => {
  it('접수는 지원자가 제출됨 요청서에 대해서만 가능하다', () => {
    expect(canAcceptRequest(supporter, makeRequest())).toBe(true);
    expect(canAcceptRequest(supporter, makeRequest({ status: 'ACCEPTED' }))).toBe(false);
    expect(canAcceptRequest(owner, makeRequest())).toBe(false);
    expect(canAcceptRequest(admin, makeRequest())).toBe(false);
  });

  it('접수 취소는 접수됨 상태의 담당 지원자만 가능하다', () => {
    const accepted = makeRequest({ status: 'ACCEPTED', assigneeId: 'assignee' });
    expect(canCancelAcceptRequest(assignee, accepted)).toBe(true);
    expect(canCancelAcceptRequest(supporter, accepted)).toBe(false);
    expect(canCancelAcceptRequest(owner, accepted)).toBe(false);
    expect(canCancelAcceptRequest(assignee, { ...accepted, status: 'FIRST_REVIEW' })).toBe(false);
    expect(canCancelAcceptRequest(assignee, { ...accepted, assigneeId: null })).toBe(false);
  });

  it('응답에 canAccept, canCancelAccept가 들어간다', () => {
    const accepted = makeRequest({ status: 'ACCEPTED', assigneeId: 'assignee' });
    expect(toRequestView(makeRequest(), supporter)).toMatchObject({ canAccept: true, canCancelAccept: false });
    expect(toRequestView(accepted, assignee)).toMatchObject({ canAccept: false, canCancelAccept: true });
    expect(toRequestView(accepted, owner)).toMatchObject({ canAccept: false, canCancelAccept: false });
  });
});

describe('작업내역 제출 조건과 작업내역 노출', () => {
  const accepted = makeRequest({ status: 'ACCEPTED', assigneeId: 'assignee' });

  it('담당 지원자만, 접수됨 또는 재작업 상태에서만 제출할 수 있다', () => {
    for (const status of ['ACCEPTED', 'REWORK']) {
      const target = { ...accepted, status };
      expect(canSubmitWorkLog(assignee, target), status).toBe(true);
      expect(canSubmitWorkLog(supporter, target), status).toBe(false);
      expect(canSubmitWorkLog(owner, target), status).toBe(false);
      expect(canSubmitWorkLog(admin, target), status).toBe(false);
    }
    for (const status of ['SUBMITTED', 'FIRST_REVIEW', 'FINAL_REVIEW', 'COMPLETED']) {
      expect(canSubmitWorkLog(assignee, { ...accepted, status }), status).toBe(false);
    }
  });

  it('재작업 상태에서는 접수 취소를 할 수 없다(작업내역이 이미 제출된 요청서)', () => {
    expect(canCancelAcceptRequest(assignee, { ...accepted, status: 'REWORK' })).toBe(false);
  });

  it('담당이어도 역할이 지원자가 아니면 제출할 수 없다', () => {
    expect(canSubmitWorkLog({ id: 'assignee', role: 'REQUESTER' }, accepted)).toBe(false);
  });

  it('응답의 canSubmitWork에 반영된다', () => {
    expect(toRequestView(accepted, assignee).canSubmitWork).toBe(true);
    expect(toRequestView(accepted, owner).canSubmitWork).toBe(false);
  });

  it('상세 응답에 작업내역이 회차 정보와 함께 들어가고 목록 응답에는 없다', () => {
    const withLogs = makeRequest({
      status: 'FIRST_REVIEW',
      assigneeId: 'assignee',
      workLogs: [
        {
          id: 'w1',
          round: 1,
          content: '작업함',
          minutes: 45,
          submittedAt: new Date('2026-11-18T00:00:00.000Z'),
          author: { id: 'assignee', name: '학생', email: 'secret@example.com' },
        },
      ],
    });
    const detail = toRequestView(withLogs, owner, { detail: true });
    expect(detail.workLogs).toEqual([
      {
        id: 'w1',
        round: 1,
        content: '작업함',
        minutes: 45,
        submittedAt: new Date('2026-11-18T00:00:00.000Z'),
        author: { id: 'assignee', name: '학생' },
      },
    ]);
    expect(toRequestView(withLogs, owner)).not.toHaveProperty('workLogs');
  });

  it('작업내역이 없으면 빈 배열이다', () => {
    expect(toRequestView(makeRequest(), owner, { detail: true }).workLogs).toEqual([]);
  });
});

describe('1차 확인 표시 조건', () => {
  const inReview = makeRequest({ status: 'FIRST_REVIEW', assigneeId: 'assignee' });

  it('요청서 작성자만, 1차 확인 대기 상태에서만 확인할 수 있다', () => {
    expect(canFirstReviewRequest(owner, inReview)).toBe(true);
    expect(canFirstReviewRequest(other, inReview)).toBe(false);
    expect(canFirstReviewRequest(assignee, inReview)).toBe(false);
    expect(canFirstReviewRequest(admin, inReview)).toBe(false);
    for (const status of ['SUBMITTED', 'ACCEPTED', 'FINAL_REVIEW', 'REWORK', 'COMPLETED']) {
      expect(canFirstReviewRequest(owner, { ...inReview, status })).toBe(false);
    }
  });

  it('관리자라도 본인이 작성한 요청서라면 확인할 수 있다', () => {
    expect(canFirstReviewRequest(admin, { ...inReview, requesterId: admin.id })).toBe(true);
  });

  it('응답의 canFirstReview에 반영된다', () => {
    expect(toRequestView(inReview, owner).canFirstReview).toBe(true);
    expect(toRequestView(inReview, assignee).canFirstReview).toBe(false);
    expect(toRequestView(makeRequest(), owner).canFirstReview).toBe(false);
  });
});

describe('최종 확인 표시 조건', () => {
  const inFinal = makeRequest({ status: 'FINAL_REVIEW', assigneeId: 'assignee' });

  it('관리자만, 최종 확인 대기 상태에서만 확인할 수 있다', () => {
    expect(canFinalReviewRequest(admin, inFinal)).toBe(true);
    expect(canFinalReviewRequest(owner, inFinal)).toBe(false);
    expect(canFinalReviewRequest(assignee, inFinal)).toBe(false);
    expect(canFinalReviewRequest(supporter, inFinal)).toBe(false);
    for (const status of ['SUBMITTED', 'ACCEPTED', 'FIRST_REVIEW', 'REWORK', 'COMPLETED']) {
      expect(canFinalReviewRequest(admin, { ...inFinal, status })).toBe(false);
    }
  });

  it('응답의 canFinalReview에 반영되고 1차 확인 플래그와 겹치지 않는다', () => {
    expect(toRequestView(inFinal, admin)).toMatchObject({ canFinalReview: true, canFirstReview: false });
    expect(toRequestView(inFinal, owner)).toMatchObject({ canFinalReview: false, canFirstReview: false });
    const inFirst = makeRequest({ status: 'FIRST_REVIEW' });
    expect(toRequestView(inFirst, owner)).toMatchObject({ canFirstReview: true, canFinalReview: false });
    expect(toRequestView(inFirst, admin).canFinalReview).toBe(false);
  });
});

describe('처리 이력(events)과 회차 표시', () => {
  const at = (n) => new Date(`2026-11-1${n}T00:00:00.000Z`);
  const ev = (id, type, actor, n, reason = null) => ({ id, type, reason, createdAt: at(n), actor });
  const names = {
    owner: { id: 'owner', name: '직원' },
    assignee: { id: 'assignee', name: '학생' },
    admin: { id: 'admin', name: '관리자' },
  };
  const history = [
    ev('e1', 'SUBMIT', names.owner, 1),
    ev('e2', 'ACCEPT', names.assignee, 2),
    ev('e3', 'WORK_SUBMIT', names.assignee, 3),
    ev('e4', 'FIRST_REJECT', names.owner, 4, '사유 하나'),
    ev('e5', 'RESUBMIT', names.assignee, 5),
    ev('e6', 'FIRST_APPROVE', names.owner, 6),
    ev('e7', 'FINAL_REJECT', names.admin, 7, '사유 둘'),
    ev('e8', 'RESUBMIT', names.assignee, 8),
  ];
  const rework = makeRequest({ status: 'FIRST_REVIEW', assigneeId: 'assignee', events: history, workLogs: [] });

  it('이력이 시간순 그대로 사유·행위자와 함께 내려온다', () => {
    const { events } = toRequestView(rework, owner, { detail: true });
    expect(events.map((e) => [e.type, e.actor.name, e.reason])).toEqual([
      ['SUBMIT', '직원', null],
      ['ACCEPT', '학생', null],
      ['WORK_SUBMIT', '학생', null],
      ['FIRST_REJECT', '직원', '사유 하나'],
      ['RESUBMIT', '학생', null],
      ['FIRST_APPROVE', '직원', null],
      ['FINAL_REJECT', '관리자', '사유 둘'],
      ['RESUBMIT', '학생', null],
    ]);
  });

  it('작업내역을 제출한 이력에만 몇 회차인지 붙고 나머지에는 붙지 않는다', () => {
    const { events } = toRequestView(rework, owner, { detail: true });
    expect(events.filter((e) => 'round' in e).map((e) => [e.id, e.round])).toEqual([
      ['e3', 1],
      ['e5', 2],
      ['e8', 3],
    ]);
    expect(events.find((e) => e.id === 'e4')).not.toHaveProperty('round');
  });

  it('작성자, 담당 지원자, 관리자는 이력을 볼 수 있다', () => {
    for (const viewer of [owner, assignee, admin]) {
      expect(toRequestView(rework, viewer, { detail: true }).events).toHaveLength(8);
    }
  });

  it('관련 없는 지원자와 다른 요청자에게는 이력과 작업내역이 비어 있다', () => {
    const withLogs = {
      ...rework,
      workLogs: [{ id: 'w1', round: 1, content: '비공개', minutes: 5, submittedAt: at(3), author: names.assignee }],
    };
    for (const viewer of [supporter, other]) {
      const view = toRequestView(withLogs, viewer, { detail: true });
      expect(view.events).toEqual([]);
      expect(view.workLogs).toEqual([]);
      expect(view.contactPhone).toBeNull();
    }
  });

  it('이력에는 행위자의 이메일 같은 다른 정보가 섞이지 않는다', () => {
    const noisy = makeRequest({
      events: [{ ...ev('e1', 'SUBMIT', { id: 'owner', name: '직원', email: 'secret@example.com' }, 1) }],
    });
    const [event] = toRequestView(noisy, owner, { detail: true }).events;
    expect(event.actor).toEqual({ id: 'owner', name: '직원' });
  });

  it('목록 응답에는 이력이 없다', () => {
    expect(toRequestView(rework, owner)).not.toHaveProperty('events');
  });

  it('이력이 없으면 빈 배열이다', () => {
    expect(toRequestView(makeRequest(), owner, { detail: true }).events).toEqual([]);
  });
});

describe('배정 표시 조건', () => {
  it('관리자만, 제출됨 상태에서만 배정할 수 있다', () => {
    expect(canAssignRequest(admin, makeRequest())).toBe(true);
    expect(canAssignRequest(owner, makeRequest())).toBe(false);
    expect(canAssignRequest(supporter, makeRequest())).toBe(false);
    for (const status of ['ACCEPTED', 'FIRST_REVIEW', 'FINAL_REVIEW', 'REWORK', 'COMPLETED']) {
      expect(canAssignRequest(admin, makeRequest({ status })), status).toBe(false);
    }
  });

  it('응답의 canAssign에 반영된다', () => {
    expect(toRequestView(makeRequest(), admin).canAssign).toBe(true);
    expect(toRequestView(makeRequest(), supporter).canAssign).toBe(false);
    expect(toRequestView(makeRequest({ status: 'ACCEPTED' }), admin).canAssign).toBe(false);
  });
});
