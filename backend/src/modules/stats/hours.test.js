import { describe, it, expect } from 'vitest';
import hours from './hours.js';
import schemas from './stats.schemas.js';

const { parseMonth, monthRange, monthOf, currentMonth, recentMonths, sumByMonth } = hours;
const { hoursQuerySchema } = schemas;

const at = (iso) => new Date(iso);

describe('parseMonth', () => {
  it('YYYY-MM 을 연·월로 나눈다', () => {
    expect(parseMonth('2026-11')).toEqual({ year: 2026, month: 11 });
    expect(parseMonth('2026-01')).toEqual({ year: 2026, month: 1 });
  });

  it.each(['2026-13', '2026-00', '2026-1', '26-11', '2026/11', '2026-11-01', ' 2026-11', '', 'abc', '1999-12', '2101-01'])(
    '형식이 아니거나 범위 밖이면 null: %j',
    (value) => {
      expect(parseMonth(value)).toBeNull();
    },
  );

  it('문자열이 아니면 null', () => {
    expect(parseMonth(undefined)).toBeNull();
    expect(parseMonth(202611)).toBeNull();
    expect(parseMonth(null)).toBeNull();
  });
});

describe('monthRange — 한국 시간(KST) 한 달', () => {
  it('2026-11 은 UTC 로 10/31 15:00 부터 11/30 15:00 직전까지', () => {
    const { start, end } = monthRange('2026-11');
    expect(start.toISOString()).toBe('2026-10-31T15:00:00.000Z');
    expect(end.toISOString()).toBe('2026-11-30T15:00:00.000Z');
  });

  it('연말은 다음 해 1월로 넘어간다', () => {
    const { start, end } = monthRange('2026-12');
    expect(start.toISOString()).toBe('2026-11-30T15:00:00.000Z');
    expect(end.toISOString()).toBe('2026-12-31T15:00:00.000Z');
  });

  it('한 달의 끝은 다음 달의 시작과 같다(빈틈·겹침 없음)', () => {
    expect(monthRange('2026-11').end.getTime()).toBe(monthRange('2026-12').start.getTime());
    expect(monthRange('2026-12').end.getTime()).toBe(monthRange('2027-01').start.getTime());
  });

  it('윤년 2월은 29일까지', () => {
    const { start, end } = monthRange('2028-02');
    expect((end - start) / (24 * 60 * 60 * 1000)).toBe(29);
    const common = monthRange('2027-02');
    expect((common.end - common.start) / (24 * 60 * 60 * 1000)).toBe(28);
  });

  it('잘못된 월이면 예외', () => {
    expect(() => monthRange('2026-13')).toThrow(RangeError);
  });
});

describe('monthOf — 어느 달에 속하는지(KST)', () => {
  it('UTC 로는 11월 마지막 날이어도 한국 시간으로 12월 1일 0시면 12월이다', () => {
    expect(monthOf(at('2026-11-30T15:00:00.000Z'))).toBe('2026-12');
  });

  it('그 1ms 전은 아직 11월', () => {
    expect(monthOf(at('2026-11-30T14:59:59.999Z'))).toBe('2026-11');
  });

  it('한 달의 첫 순간은 그 달', () => {
    expect(monthOf(at('2026-10-31T15:00:00.000Z'))).toBe('2026-11');
  });

  it('연말·연초 경계', () => {
    expect(monthOf(at('2026-12-31T14:59:59.999Z'))).toBe('2026-12');
    expect(monthOf(at('2026-12-31T15:00:00.000Z'))).toBe('2027-01');
  });

  it('monthRange 와 짝이 맞는다: 구간의 시작은 그 달, 끝은 다음 달', () => {
    const { start, end } = monthRange('2026-11');
    expect(monthOf(start)).toBe('2026-11');
    expect(monthOf(new Date(end.getTime() - 1))).toBe('2026-11');
    expect(monthOf(end)).toBe('2026-12');
  });
});

describe('currentMonth / recentMonths', () => {
  it('이번 달은 한국 시간 기준', () => {
    expect(currentMonth(at('2026-11-18T03:00:00.000Z'))).toBe('2026-11');
    expect(currentMonth(at('2026-11-30T16:00:00.000Z'))).toBe('2026-12');
  });

  it('최근 n개월은 최신이 앞이고 연도를 넘어간다', () => {
    expect(recentMonths(3, at('2026-01-15T00:00:00.000Z'))).toEqual(['2026-01', '2025-12', '2025-11']);
  });

  it('기본은 12개월', () => {
    const months = recentMonths(undefined, at('2026-11-18T00:00:00.000Z'));
    expect(months).toHaveLength(12);
    expect(months[0]).toBe('2026-11');
    expect(months[11]).toBe('2025-12');
  });
});

describe('sumByMonth', () => {
  const months = ['2026-12', '2026-11', '2026-10'];

  it('같은 달 기록의 분을 더하고 건수를 센다', () => {
    const result = sumByMonth(
      [
        { submittedAt: at('2026-11-05T03:00:00.000Z'), minutes: 90 },
        { submittedAt: at('2026-11-20T03:00:00.000Z'), minutes: 30 },
      ],
      months,
    );
    expect(result).toEqual([
      { month: '2026-12', minutes: 0, logCount: 0 },
      { month: '2026-11', minutes: 120, logCount: 2 },
      { month: '2026-10', minutes: 0, logCount: 0 },
    ]);
  });

  it('기록이 없는 달은 0으로 채우고 받은 달 순서를 지킨다', () => {
    expect(sumByMonth([], months).map((row) => row.month)).toEqual(months);
    expect(sumByMonth([], months).every((row) => row.minutes === 0 && row.logCount === 0)).toBe(true);
  });

  it('목록에 없는 달의 기록은 무시한다', () => {
    const result = sumByMonth([{ submittedAt: at('2025-01-05T03:00:00.000Z'), minutes: 500 }], months);
    expect(result.reduce((sum, row) => sum + row.minutes, 0)).toBe(0);
  });

  it('KST 경계: UTC 로 11월 말일 15시 이후 기록은 12월에 들어간다', () => {
    const result = sumByMonth(
      [
        { submittedAt: at('2026-11-30T14:59:59.999Z'), minutes: 10 },
        { submittedAt: at('2026-11-30T15:00:00.000Z'), minutes: 20 },
      ],
      months,
    );
    expect(result.find((row) => row.month === '2026-11').minutes).toBe(10);
    expect(result.find((row) => row.month === '2026-12').minutes).toBe(20);
  });
});

describe('hoursQuerySchema', () => {
  it('month 는 생략할 수 있다', () => {
    expect(hoursQuerySchema.safeParse({}).success).toBe(true);
  });

  it('YYYY-MM 은 통과하고 앞뒤 공백은 지운다', () => {
    expect(hoursQuerySchema.parse({ month: ' 2026-11 ' }).month).toBe('2026-11');
  });

  it.each(['2026-13', '2026-1', 'november', '2026-11-01', ''])('잘못된 월은 거부: %j', (month) => {
    const result = hoursQuerySchema.safeParse({ month });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toContain('YYYY-MM');
  });
});
