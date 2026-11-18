// vitest 는 ESM 전용이라 테스트 파일만 import 문법을 쓴다. 소스(CommonJS)는 기본 import 후 구조 분해한다.
import { describe, it, expect } from 'vitest';
import machine from './stateMachine.js';

const { STATUS, ACTION, TransitionError, transition } = machine;

// ── 고정 행위자 ───────────────────────────────────────────────
const owner = { id: 'owner', role: 'REQUESTER' }; // 요청서 작성자
const otherRequester = { id: 'other-requester', role: 'REQUESTER' };
const assignee = { id: 'assignee', role: 'SUPPORTER' }; // 담당 지원자
const otherSupporter = { id: 'other-supporter', role: 'SUPPORTER' };
const admin = { id: 'admin', role: 'ADMIN' };

function makeRequest(status, overrides = {}) {
  return { status, requesterId: owner.id, assigneeId: assignee.id, ...overrides };
}

/** 대표 허용 전이: [행동, 시작 상태, 행위자, 기대 다음 상태, 요청서 보정, payload] */
const ALLOWED = [
  [ACTION.ACCEPT, STATUS.SUBMITTED, otherSupporter, STATUS.ACCEPTED, { assigneeId: null }],
  [ACTION.ASSIGN, STATUS.SUBMITTED, admin, STATUS.ACCEPTED, { assigneeId: null }],
  [ACTION.CANCEL_ACCEPT, STATUS.ACCEPTED, assignee, STATUS.SUBMITTED],
  [ACTION.WORK_SUBMIT, STATUS.ACCEPTED, assignee, STATUS.FIRST_REVIEW],
  [ACTION.FIRST_APPROVE, STATUS.FIRST_REVIEW, owner, STATUS.FINAL_REVIEW],
  [ACTION.FIRST_REJECT, STATUS.FIRST_REVIEW, owner, STATUS.REWORK, {}, { reason: '내용 보완 필요' }],
  [ACTION.FINAL_APPROVE, STATUS.FINAL_REVIEW, admin, STATUS.COMPLETED],
  [ACTION.FINAL_REJECT, STATUS.FINAL_REVIEW, admin, STATUS.REWORK, {}, { reason: '증빙 부족' }],
  [ACTION.RESUBMIT, STATUS.REWORK, assignee, STATUS.FIRST_REVIEW],
];

describe('transition: 허용 전이', () => {
  it.each(ALLOWED)('%s: %s → 허용', (action, from, actor, to, overrides = {}, payload) => {
    const result = transition(makeRequest(from, overrides), action, actor, payload);
    expect(result).toEqual({ status: to, eventType: action });
  });

  it('모든 행동이 최소 한 번은 허용 전이 표에 있다', () => {
    const covered = new Set(ALLOWED.map(([action]) => action));
    expect([...covered].sort()).toEqual(Object.values(ACTION).sort());
  });
});

describe('transition: 잘못된 상태에서는 409', () => {
  const allStatuses = Object.values(STATUS);

  it.each(ALLOWED)('%s는 %s 외의 모든 상태에서 거부된다', (action, from, actor, _to, overrides = {}, payload) => {
    for (const status of allStatuses.filter((s) => s !== from)) {
      expect(() => transition(makeRequest(status, overrides), action, actor, payload)).toThrow(
        expect.objectContaining({ code: 'INVALID_STATE', statusCode: 409 })
      );
    }
  });

  it('제출됨에서 완료로 건너뛸 수 없다', () => {
    expect(() => transition(makeRequest(STATUS.SUBMITTED), ACTION.FINAL_APPROVE, admin)).toThrow(
      expect.objectContaining({ code: 'INVALID_STATE' })
    );
  });

  it('완료는 종료 상태라 어떤 행동도 받지 않는다', () => {
    for (const [action, , actor, , overrides = {}, payload] of ALLOWED) {
      expect(() => transition(makeRequest(STATUS.COMPLETED, overrides), action, actor, payload)).toThrow(
        expect.objectContaining({ code: 'INVALID_STATE' })
      );
    }
  });
});

describe('transition: 행위자 권한은 403', () => {
  const forbidden = (request, action, actor, payload) => {
    expect(() => transition(request, action, actor, payload)).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN', statusCode: 403 })
    );
  };

  it('접수는 지원자만 할 수 있다', () => {
    const request = makeRequest(STATUS.SUBMITTED, { assigneeId: null });
    forbidden(request, ACTION.ACCEPT, owner);
    forbidden(request, ACTION.ACCEPT, admin);
  });

  it('배정은 관리자만 할 수 있다', () => {
    const request = makeRequest(STATUS.SUBMITTED, { assigneeId: null });
    forbidden(request, ACTION.ASSIGN, owner);
    forbidden(request, ACTION.ASSIGN, otherSupporter);
  });

  it('접수 취소와 작업내역 제출은 담당 지원자만 할 수 있다', () => {
    for (const action of [ACTION.CANCEL_ACCEPT, ACTION.WORK_SUBMIT]) {
      forbidden(makeRequest(STATUS.ACCEPTED), action, otherSupporter);
      forbidden(makeRequest(STATUS.ACCEPTED), action, owner);
      forbidden(makeRequest(STATUS.ACCEPTED), action, admin);
    }
  });

  it('담당자가 비어 있는 요청서는 지원자 누구도 담당으로 취급하지 않는다', () => {
    const request = makeRequest(STATUS.ACCEPTED, { assigneeId: null });
    forbidden(request, ACTION.WORK_SUBMIT, otherSupporter);
    forbidden(request, ACTION.CANCEL_ACCEPT, assignee);
  });

  it('담당자였더라도 역할이 지원자가 아니게 되면 작업할 수 없다', () => {
    const demoted = { id: assignee.id, role: 'REQUESTER' };
    forbidden(makeRequest(STATUS.ACCEPTED), ACTION.WORK_SUBMIT, demoted);
  });

  it('1차 확인은 요청서 작성자만 할 수 있다', () => {
    for (const [action, payload] of [
      [ACTION.FIRST_APPROVE, undefined],
      [ACTION.FIRST_REJECT, { reason: '사유' }],
    ]) {
      forbidden(makeRequest(STATUS.FIRST_REVIEW), action, otherRequester, payload);
      forbidden(makeRequest(STATUS.FIRST_REVIEW), action, assignee, payload);
      forbidden(makeRequest(STATUS.FIRST_REVIEW), action, admin, payload);
    }
  });

  it('최종 확인은 관리자만 할 수 있다', () => {
    for (const [action, payload] of [
      [ACTION.FINAL_APPROVE, undefined],
      [ACTION.FINAL_REJECT, { reason: '사유' }],
    ]) {
      forbidden(makeRequest(STATUS.FINAL_REVIEW), action, owner, payload);
      forbidden(makeRequest(STATUS.FINAL_REVIEW), action, assignee, payload);
    }
  });

  it('재제출은 담당 지원자만 할 수 있다', () => {
    forbidden(makeRequest(STATUS.REWORK), ACTION.RESUBMIT, otherSupporter);
    forbidden(makeRequest(STATUS.REWORK), ACTION.RESUBMIT, owner);
  });

  it('권한이 없는 사용자에게는 상태보다 권한 오류(403)를 먼저 낸다', () => {
    // 완료된 요청서에 대해서도 권한 없는 사용자는 상태를 알 수 없다.
    forbidden(makeRequest(STATUS.COMPLETED), ACTION.FINAL_APPROVE, owner);
  });
});

describe('transition: 반려 사유', () => {
  const rejects = [
    [ACTION.FIRST_REJECT, STATUS.FIRST_REVIEW, owner],
    [ACTION.FINAL_REJECT, STATUS.FINAL_REVIEW, admin],
  ];

  it.each(rejects)('%s는 사유가 없으면 400', (action, from, actor) => {
    const request = makeRequest(from);
    for (const payload of [undefined, {}, { reason: '' }, { reason: '   ' }, { reason: null }, { reason: 123 }]) {
      expect(() => transition(request, action, actor, payload)).toThrow(
        expect.objectContaining({ code: 'REASON_REQUIRED', statusCode: 400 })
      );
    }
  });

  it('승인과 그 밖의 행동은 사유가 없어도 된다', () => {
    expect(() => transition(makeRequest(STATUS.FIRST_REVIEW), ACTION.FIRST_APPROVE, owner)).not.toThrow();
    expect(() => transition(makeRequest(STATUS.FINAL_REVIEW), ACTION.FINAL_APPROVE, admin)).not.toThrow();
  });
});

describe('transition: 잘못된 입력', () => {
  it('알 수 없는 행동은 400', () => {
    expect(() => transition(makeRequest(STATUS.SUBMITTED), 'DELETE_EVERYTHING', admin)).toThrow(
      expect.objectContaining({ code: 'UNKNOWN_ACTION', statusCode: 400 })
    );
  });

  it('프로토타입 키(toString 등)를 행동으로 쓸 수 없다', () => {
    expect(() => transition(makeRequest(STATUS.SUBMITTED), 'toString', admin)).toThrow(
      expect.objectContaining({ code: 'UNKNOWN_ACTION' })
    );
  });

  it('행위자가 없으면 401', () => {
    expect(() => transition(makeRequest(STATUS.SUBMITTED), ACTION.ACCEPT, undefined)).toThrow(
      expect.objectContaining({ code: 'UNAUTHENTICATED', statusCode: 401 })
    );
  });

  it('던지는 오류는 TransitionError이다', () => {
    expect(() => transition(makeRequest(STATUS.SUBMITTED), ACTION.FINAL_APPROVE, admin)).toThrow(TransitionError);
  });

  it('입력 객체를 바꾸지 않고 결과도 바꿀 수 없다', () => {
    const request = makeRequest(STATUS.SUBMITTED, { assigneeId: null });
    const snapshot = { ...request };
    const result = transition(request, ACTION.ACCEPT, otherSupporter);
    expect(request).toEqual(snapshot);
    expect(Object.isFrozen(result)).toBe(true);
  });
});

describe('transition: 전체 흐름', () => {
  /** 상태를 따라가며 한 단계씩 적용한다. 담당자는 접수 시점에 정해진다. */
  function apply(request, action, actor, payload) {
    const { status } = transition(request, action, actor, payload);
    const assigneeId = action === ACTION.ACCEPT || action === ACTION.ASSIGN ? assignee.id : request.assigneeId;
    return { ...request, status, assigneeId };
  }

  it('제출부터 완료까지: 반려와 재제출을 거쳐도 끝까지 통과한다', () => {
    let request = makeRequest(STATUS.SUBMITTED, { assigneeId: null });
    const steps = [
      [ACTION.ACCEPT, assignee, undefined, STATUS.ACCEPTED],
      [ACTION.WORK_SUBMIT, assignee, undefined, STATUS.FIRST_REVIEW],
      [ACTION.FIRST_REJECT, owner, { reason: '1차 반려' }, STATUS.REWORK],
      [ACTION.RESUBMIT, assignee, undefined, STATUS.FIRST_REVIEW],
      [ACTION.FIRST_APPROVE, owner, undefined, STATUS.FINAL_REVIEW],
      [ACTION.FINAL_REJECT, admin, { reason: '최종 반려' }, STATUS.REWORK],
      [ACTION.RESUBMIT, assignee, undefined, STATUS.FIRST_REVIEW], // 최종 반려 후에도 1차부터 다시
      [ACTION.FIRST_APPROVE, owner, undefined, STATUS.FINAL_REVIEW],
      [ACTION.FINAL_APPROVE, admin, undefined, STATUS.COMPLETED],
    ];

    for (const [action, actor, payload, expected] of steps) {
      request = apply(request, action, actor, payload);
      expect(request.status).toBe(expected);
    }
  });

  it('접수를 취소하면 다른 지원자가 다시 접수할 수 있다', () => {
    let request = makeRequest(STATUS.SUBMITTED, { assigneeId: null });
    request = apply(request, ACTION.ACCEPT, assignee);
    request = { ...apply(request, ACTION.CANCEL_ACCEPT, assignee), assigneeId: null };
    expect(request.status).toBe(STATUS.SUBMITTED);
    expect(transition(request, ACTION.ACCEPT, otherSupporter).status).toBe(STATUS.ACCEPTED);
  });
});
