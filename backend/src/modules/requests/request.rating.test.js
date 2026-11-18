// 만족도 평가(FR-12)의 순수 규칙: 입력 스키마, 평가 가능 여부, 응답 노출 범위.
import { describe, it, expect } from 'vitest';
import policy from './request.policy.js';
import schemas from './request.schemas.js';

const { canRateRequest, toRequestView } = policy;
const { ratingSchema, MAX_RATING_COMMENT_LENGTH } = schemas;

const owner = { id: 'owner', role: 'REQUESTER' };
const other = { id: 'other', role: 'REQUESTER' };
const assignee = { id: 'assignee', role: 'SUPPORTER' };
const supporter = { id: 'supporter', role: 'SUPPORTER' };
const admin = { id: 'admin', role: 'ADMIN' };

const rating = { score: 4, comment: '빨라서 좋았어요', createdAt: new Date('2026-11-18T00:00:00.000Z') };

function makeRequest(overrides = {}) {
  return {
    id: 'r1',
    title: '제목',
    content: '내용',
    status: 'COMPLETED',
    urgency: 'NORMAL',
    department: '기획처',
    contactName: '홍길동',
    contactPhone: '010-1234-5678',
    interviewAt: new Date('2026-11-20T01:00:00.000Z'),
    desiredDate: new Date('2026-12-01T00:00:00.000Z'),
    requesterId: owner.id,
    assigneeId: assignee.id,
    supportType: { id: 't1', name: '업무 자동화' },
    requester: { id: owner.id, name: '직원' },
    assignee: { id: assignee.id, name: '학생' },
    createdAt: new Date('2026-11-17T00:00:00.000Z'),
    updatedAt: new Date('2026-11-17T00:00:00.000Z'),
    completedAt: new Date('2026-11-18T00:00:00.000Z'),
    rating: null,
    ...overrides,
  };
}

describe('ratingSchema', () => {
  it.each([1, 2, 3, 4, 5])('%i점은 통과', (score) => {
    expect(ratingSchema.parse({ score }).score).toBe(score);
  });

  it.each([0, 6, -1, 3.5, 100])('범위 밖이거나 정수가 아닌 점수는 거부: %s', (score) => {
    expect(ratingSchema.safeParse({ score }).success).toBe(false);
  });

  it('점수가 없거나 숫자가 아니면 거부(문자열 "5"도 거부)', () => {
    expect(ratingSchema.safeParse({}).success).toBe(false);
    expect(ratingSchema.safeParse({ score: '5' }).success).toBe(false);
    expect(ratingSchema.safeParse({ score: null }).success).toBe(false);
  });

  it('후기는 선택이고, 없거나 공백뿐이면 null로 저장한다', () => {
    expect(ratingSchema.parse({ score: 5 }).comment).toBeNull();
    expect(ratingSchema.parse({ score: 5, comment: '' }).comment).toBeNull();
    expect(ratingSchema.parse({ score: 5, comment: '   ' }).comment).toBeNull();
    expect(ratingSchema.parse({ score: 5, comment: null }).comment).toBeNull();
  });

  it('후기의 앞뒤 공백은 지운다', () => {
    expect(ratingSchema.parse({ score: 5, comment: '  좋아요  ' }).comment).toBe('좋아요');
  });

  it('후기는 한 줄만: 줄바꿈이 있으면 거부', () => {
    expect(ratingSchema.safeParse({ score: 5, comment: '첫 줄\n둘째 줄' }).success).toBe(false);
    expect(ratingSchema.safeParse({ score: 5, comment: '첫 줄\r둘째 줄' }).success).toBe(false);
  });

  it('후기 길이 상한: 경계값은 통과, 넘으면 거부', () => {
    expect(ratingSchema.safeParse({ score: 5, comment: 'ㄱ'.repeat(MAX_RATING_COMMENT_LENGTH) }).success).toBe(true);
    expect(ratingSchema.safeParse({ score: 5, comment: 'ㄱ'.repeat(MAX_RATING_COMMENT_LENGTH + 1) }).success).toBe(false);
  });

  it('후기가 글자가 아니면 거부', () => {
    expect(ratingSchema.safeParse({ score: 5, comment: 123 }).success).toBe(false);
  });
});

describe('canRateRequest', () => {
  it('작성자는 완료된 요청서에 아직 평가가 없으면 남길 수 있다', () => {
    expect(canRateRequest(owner, makeRequest())).toBe(true);
  });

  it('이미 평가가 있으면 다시 남길 수 없다', () => {
    expect(canRateRequest(owner, makeRequest({ rating }))).toBe(false);
  });

  it.each(['SUBMITTED', 'ACCEPTED', 'FIRST_REVIEW', 'FINAL_REVIEW', 'REWORK'])('완료 전(%s)에는 남길 수 없다', (status) => {
    expect(canRateRequest(owner, makeRequest({ status }))).toBe(false);
  });

  it('작성자가 아니면 못 남긴다(다른 요청자·담당 지원자·다른 지원자·관리자)', () => {
    for (const user of [other, assignee, supporter, admin]) {
      expect(canRateRequest(user, makeRequest())).toBe(false);
    }
  });

  it('관리자가 쓴 요청서는 그 관리자가 작성자이므로 남길 수 있다', () => {
    expect(canRateRequest(admin, makeRequest({ requesterId: admin.id }))).toBe(true);
  });
});

describe('toRequestView: 만족도 노출', () => {
  it('작성자·담당 지원자·관리자는 평가를 볼 수 있다', () => {
    for (const user of [owner, assignee, admin]) {
      const view = toRequestView(makeRequest({ rating }), user, { detail: true });
      expect(view.rating).toEqual({ score: 4, comment: '빨라서 좋았어요', createdAt: rating.createdAt });
    }
  });

  it('요청서와 무관한 지원자·다른 요청자에게는 숨긴다', () => {
    for (const user of [supporter, other]) {
      expect(toRequestView(makeRequest({ rating }), user, { detail: true }).rating).toBeNull();
    }
  });

  it('평가가 없으면 null, 후기가 없으면 comment 는 null', () => {
    expect(toRequestView(makeRequest(), owner, { detail: true }).rating).toBeNull();
    const noComment = toRequestView(makeRequest({ rating: { ...rating, comment: null } }), owner, { detail: true });
    expect(noComment.rating.comment).toBeNull();
  });

  it('canRate 는 작성자에게만 true 이고 평가 후에는 false', () => {
    expect(toRequestView(makeRequest(), owner, { detail: true }).canRate).toBe(true);
    expect(toRequestView(makeRequest(), admin, { detail: true }).canRate).toBe(false);
    expect(toRequestView(makeRequest({ rating }), owner, { detail: true }).canRate).toBe(false);
  });

  it('내부 식별자(requestId 등)는 내보내지 않는다', () => {
    const view = toRequestView(makeRequest({ rating: { ...rating, id: 'x', requestId: 'r1' } }), owner, { detail: true });
    expect(Object.keys(view.rating).sort()).toEqual(['comment', 'createdAt', 'score']);
  });
});
