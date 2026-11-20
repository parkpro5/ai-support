// 희망 완료일 하루 전 알림의 시간 계산(순수 함수). DB·전송 접근 없음.
// vitest 는 ESM 전용이라 테스트 파일만 import 문법을 쓴다. 소스(CommonJS)는 기본 import 후 구조 분해한다.
import { describe, it, expect } from 'vitest';
import job from './dueReminderTime.js';

const { isReminderTime, tomorrowKstDate, kstHour, REMINDER_HOUR_KST } = job;

// 한국 시간 → UTC 시각 (KST = UTC+9)
const kst = (iso) => new Date(`${iso}+09:00`);

describe('kstHour', () => {
  it('UTC 시각을 한국 시간의 시(0~23)로 바꾼다', () => {
    expect(kstHour(new Date('2026-11-19T00:00:00Z'))).toBe(9);
    expect(kstHour(new Date('2026-11-19T14:59:59Z'))).toBe(23);
    expect(kstHour(new Date('2026-11-19T15:00:00Z'))).toBe(0);
    expect(kstHour(new Date('2026-11-19T23:59:59Z'))).toBe(8);
  });
});

describe('isReminderTime: 한국 시간 오전 9시 이후에만 보낸다', () => {
  it('9시 정각부터 자정 전까지는 true', () => {
    expect(REMINDER_HOUR_KST).toBe(9);
    expect(isReminderTime(kst('2026-11-19T09:00:00'))).toBe(true);
    expect(isReminderTime(kst('2026-11-19T18:30:00'))).toBe(true);
    expect(isReminderTime(kst('2026-11-19T23:59:59'))).toBe(true);
  });

  it('자정부터 8시 59분까지는 false', () => {
    expect(isReminderTime(kst('2026-11-19T00:00:00'))).toBe(false);
    expect(isReminderTime(kst('2026-11-19T08:59:59'))).toBe(false);
  });
});

describe('tomorrowKstDate: 한국 시간 기준 내일 날짜(UTC 자정)', () => {
  const iso = (d) => d.toISOString();

  it('한국 시간 낮이면 한국 날짜의 다음 날이다', () => {
    expect(iso(tomorrowKstDate(kst('2026-11-19T12:00:00')))).toBe('2026-11-20T00:00:00.000Z');
  });

  it('한국 시간 자정 직후에는 UTC로는 아직 전날이어도 한국 날짜로 센다', () => {
    // UTC 2026-11-18 15:30 = 한국 2026-11-19 00:30 → 내일은 11-20
    expect(iso(tomorrowKstDate(new Date('2026-11-18T15:30:00Z')))).toBe('2026-11-20T00:00:00.000Z');
  });

  it('한국 시간 자정 직전에도 한국 날짜 기준이다', () => {
    expect(iso(tomorrowKstDate(kst('2026-11-19T23:59:59')))).toBe('2026-11-20T00:00:00.000Z');
  });

  it('달과 해의 경계를 넘긴다', () => {
    expect(iso(tomorrowKstDate(kst('2026-11-30T10:00:00')))).toBe('2026-12-01T00:00:00.000Z');
    expect(iso(tomorrowKstDate(kst('2026-12-31T10:00:00')))).toBe('2027-01-01T00:00:00.000Z');
    expect(iso(tomorrowKstDate(kst('2028-02-28T10:00:00')))).toBe('2028-02-29T00:00:00.000Z');
  });
});
