// 대시보드 집계의 순수 규칙. 기대값은 손으로 계산한 값이다.
import { describe, it, expect } from 'vitest';
import dashboard from './dashboard.js';
import schemas from './stats.schemas.js';

const {
  MAX_PERIOD_MONTHS,
  averageMinutes,
  averageScore,
  processingMinutes,
  periodMonths,
  summarizeCompleted,
  countByType,
  summarizeSupporters,
} = dashboard;
const { periodQuerySchema } = schemas;

const at = (iso) => new Date(iso);
const HOUR = 60 * 60 * 1000;

/** completedAt 에서 hours 시간 전에 제출된 완료 요청서. */
const done = (completedAtIso, hours, extra = {}) => {
  const completedAt = at(completedAtIso);
  return { completedAt, createdAt: new Date(completedAt.getTime() - hours * HOUR), ...extra };
};

describe('averageMinutes / averageScore', () => {
  it('대상이 없으면 null(0과 구분)', () => {
    expect(averageMinutes([])).toBeNull();
    expect(averageScore([])).toBeNull();
  });

  it('분 평균은 정수로 반올림', () => {
    expect(averageMinutes([180, 300])).toBe(240);
    expect(averageMinutes([10, 11])).toBe(11); // 10.5 → 11
    expect(averageMinutes([0])).toBe(0);
  });

  it('점수 평균은 소수 첫째 자리까지', () => {
    expect(averageScore([5, 4])).toBe(4.5);
    expect(averageScore([5, 4, 4])).toBe(4.3); // 4.333…
    expect(averageScore([5, 5, 4])).toBe(4.7); // 4.666…
    expect(averageScore([3])).toBe(3);
  });
});

describe('processingMinutes — 제출부터 완료까지', () => {
  it('3시간은 180분, 하루는 1440분', () => {
    expect(processingMinutes(done('2026-11-10T03:00:00Z', 3))).toBe(180);
    expect(processingMinutes(done('2026-11-10T03:00:00Z', 24))).toBe(1440);
  });

  it('초 단위 차이는 가장 가까운 분으로', () => {
    const request = { createdAt: at('2026-11-10T00:00:00.000Z'), completedAt: at('2026-11-10T00:01:31.000Z') };
    expect(processingMinutes(request)).toBe(2);
  });

  it('완료가 제출보다 앞서는 비정상 값도 음수로 내보내지 않는다', () => {
    const request = { createdAt: at('2026-11-10T03:00:00Z'), completedAt: at('2026-11-10T02:00:00Z') };
    expect(processingMinutes(request)).toBe(0);
  });
});

describe('periodMonths', () => {
  it('오래된 달부터 이번 달까지, 연도를 넘어간다', () => {
    expect(periodMonths(4, at('2026-02-10T00:00:00Z'))).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });

  it('1개월이면 이번 달뿐이고, 기준은 한국 시간', () => {
    expect(periodMonths(1, at('2026-11-30T15:00:00Z'))).toEqual(['2026-12']);
  });
});

describe('summarizeCompleted', () => {
  const months = ['2026-10', '2026-11'];

  it('완료 시각의 달로 나눠 건수와 평균 처리 시간을 낸다', () => {
    const result = summarizeCompleted(
      [
        done('2026-11-10T03:00:00Z', 3), // 180분
        done('2026-11-12T03:00:00Z', 5), // 300분
        done('2026-10-20T03:00:00Z', 24), // 1440분
      ],
      months,
    );

    expect(result.months).toEqual([
      { month: '2026-10', completedCount: 1, avgProcessingMinutes: 1440 },
      { month: '2026-11', completedCount: 2, avgProcessingMinutes: 240 },
    ]);
    expect(result.completedCount).toBe(3);
    expect(result.avgProcessingMinutes).toBe(640); // (180+300+1440)/3
  });

  it('전체 평균은 달별 평균의 평균이 아니라 건 전체의 평균이다', () => {
    const result = summarizeCompleted(
      [done('2026-10-20T03:00:00Z', 10), done('2026-11-10T03:00:00Z', 1), done('2026-11-11T03:00:00Z', 1)],
      months,
    );
    // 달별 평균의 평균이라면 (600+60)/2=330, 건 전체 평균은 (600+60+60)/3=240
    expect(result.avgProcessingMinutes).toBe(240);
  });

  it('완료가 없는 달은 0건·null, 기간 밖 달의 완료는 무시', () => {
    const result = summarizeCompleted([done('2025-01-10T03:00:00Z', 3)], months);

    expect(result.months).toEqual([
      { month: '2026-10', completedCount: 0, avgProcessingMinutes: null },
      { month: '2026-11', completedCount: 0, avgProcessingMinutes: null },
    ]);
    expect(result.completedCount).toBe(0);
    expect(result.avgProcessingMinutes).toBeNull();
  });

  it('달 경계는 한국 시간: 11/30 15:00Z 완료는 12월', () => {
    const result = summarizeCompleted(
      [done('2026-11-30T14:59:59.999Z', 1), done('2026-11-30T15:00:00.000Z', 1)],
      ['2026-11', '2026-12'],
    );
    expect(result.months.map((row) => row.completedCount)).toEqual([1, 1]);
  });
});

describe('countByType', () => {
  const types = [
    { id: 't1', name: '업무 자동화', active: true, sortOrder: 1 },
    { id: 't2', name: '문서 작성', active: true, sortOrder: 2 },
    { id: 't3', name: '옛 유형', active: false, sortOrder: 3 },
    { id: 't4', name: '쓰지 않는 옛 유형', active: false, sortOrder: 4 },
  ];

  it('요청 건수와 완료 건수를 따로 센다', () => {
    const rows = countByType(
      types,
      [{ supportTypeId: 't1' }, { supportTypeId: 't1' }, { supportTypeId: 't1' }, { supportTypeId: 't2' }],
      [{ supportTypeId: 't1' }, { supportTypeId: 't1' }, { supportTypeId: 't2' }],
    );
    expect(rows).toEqual([
      { id: 't1', name: '업무 자동화', requested: 3, completed: 2 },
      { id: 't2', name: '문서 작성', requested: 1, completed: 1 },
    ]);
  });

  it('요청이 없는 유형도 사용 중이면 0으로 나온다', () => {
    const rows = countByType(types, [], []);
    expect(rows.map((row) => [row.id, row.requested, row.completed])).toEqual([
      ['t1', 0, 0],
      ['t2', 0, 0],
    ]);
  });

  it('사용 중지된 유형은 기간 안에 활동이 있었을 때만 나온다', () => {
    const rows = countByType(types, [{ supportTypeId: 't3' }], []);
    expect(rows.map((row) => row.id)).toContain('t3');
    expect(rows.map((row) => row.id)).not.toContain('t4');
  });

  it('많이 요청된 순으로, 같으면 표시 순서대로', () => {
    const rows = countByType(types, [{ supportTypeId: 't2' }, { supportTypeId: 't2' }, { supportTypeId: 't1' }], []);
    expect(rows.map((row) => row.id)).toEqual(['t2', 't1']);
    const tie = countByType(types, [{ supportTypeId: 't2' }, { supportTypeId: 't1' }], []);
    expect(tie.map((row) => row.id)).toEqual(['t1', 't2']);
  });

  it('정렬용 내부 값은 내보내지 않는다', () => {
    const [row] = countByType(types, [], []);
    expect(Object.keys(row).sort()).toEqual(['completed', 'id', 'name', 'requested']);
  });
});

describe('summarizeSupporters', () => {
  const users = [
    { id: 'u1', name: '가지원' },
    { id: 'u2', name: '나지원' },
    { id: 'u3', name: '다지원' },
  ];

  it('지원자별 완료 건수·평균 처리 시간·근로시간·평균 만족도', () => {
    const rows = summarizeSupporters(
      users,
      [
        done('2026-11-10T03:00:00Z', 3, { assigneeId: 'u1' }), // 180
        done('2026-11-12T03:00:00Z', 5, { assigneeId: 'u1' }), // 300
        done('2026-10-20T03:00:00Z', 24, { assigneeId: 'u2' }), // 1440
      ],
      [
        { authorId: 'u1', minutes: 90 },
        { authorId: 'u1', minutes: 30 },
        { authorId: 'u2', minutes: 45 },
      ],
      [
        { assigneeId: 'u1', score: 5 },
        { assigneeId: 'u1', score: 4 },
      ],
    );

    expect(rows.find((row) => row.id === 'u1')).toEqual({
      id: 'u1',
      name: '가지원',
      completedCount: 2,
      avgProcessingMinutes: 240,
      workMinutes: 120,
      workLogCount: 2,
      avgRating: 4.5,
      ratingCount: 2,
    });
    expect(rows.find((row) => row.id === 'u2')).toMatchObject({
      completedCount: 1,
      avgProcessingMinutes: 1440,
      workMinutes: 45,
      avgRating: null,
      ratingCount: 0,
    });
  });

  it('활동이 없는 지원자도 0건·null 로 나온다', () => {
    const [row] = summarizeSupporters([users[2]], [], [], []);
    expect(row).toEqual({
      id: 'u3',
      name: '다지원',
      completedCount: 0,
      avgProcessingMinutes: null,
      workMinutes: 0,
      workLogCount: 0,
      avgRating: null,
      ratingCount: 0,
    });
  });

  it('다른 사람의 기록은 섞이지 않는다', () => {
    const rows = summarizeSupporters(
      users,
      [done('2026-11-10T03:00:00Z', 3, { assigneeId: 'u2' })],
      [{ authorId: 'u2', minutes: 500 }],
      [{ assigneeId: 'u2', score: 1 }],
    );
    expect(rows.find((row) => row.id === 'u1')).toMatchObject({ completedCount: 0, workMinutes: 0, avgRating: null });
  });

  it('완료 건수 많은 순, 같으면 근로시간 많은 순, 그래도 같으면 이름순', () => {
    const rows = summarizeSupporters(
      users,
      [
        done('2026-11-10T03:00:00Z', 1, { assigneeId: 'u1' }),
        done('2026-11-10T03:00:00Z', 1, { assigneeId: 'u2' }),
      ],
      [{ authorId: 'u2', minutes: 10 }],
      [],
    );
    expect(rows.map((row) => row.id)).toEqual(['u2', 'u1', 'u3']);
  });
});

describe('periodQuerySchema', () => {
  it('생략하면 6개월', () => {
    expect(periodQuerySchema.parse({}).months).toBe(6);
  });

  it.each([
    ['1', 1],
    ['12', 12],
    [' 6 ', 6],
    ['06', 6],
    [String(MAX_PERIOD_MONTHS), MAX_PERIOD_MONTHS],
  ])('올바른 개월 수 %j → %i', (input, expected) => {
    expect(periodQuerySchema.parse({ months: input }).months).toBe(expected);
  });

  it.each(['0', String(MAX_PERIOD_MONTHS + 1), '-1', '6.5', 'abc', '', '1e1', '1000'])('잘못된 개월 수는 거부: %j', (input) => {
    const result = periodQuerySchema.safeParse({ months: input });
    expect(result.success).toBe(false);
  });
});
