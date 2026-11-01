import { describe, expect, it } from 'vitest';
import { addDays, dayBounds, dayEndMs, dayKeyOf, dayRange, dayStartMs, diffDays, weekdayMon0, wallClock, zonedTimeToUtc } from './day';

const IST = { timezone: 'Europe/Istanbul', day_start_hour: 4 };
const NY = { timezone: 'America/New_York', day_start_hour: 4 };
const BER = { timezone: 'Europe/Berlin', day_start_hour: 4 };
const H = 3_600_000;

describe('day keys', () => {
  it('03:59 local belongs to the previous day, 04:00 to the new one', () => {
    // Istanbul is UTC+3 all year.
    expect(dayKeyOf(Date.UTC(2026, 9, 21, 0, 59), IST)).toBe('2026-10-20'); // 03:59 local
    expect(dayKeyOf(Date.UTC(2026, 9, 21, 1, 0), IST)).toBe('2026-10-21'); // 04:00 local
    expect(dayKeyOf(Date.UTC(2026, 9, 20, 20, 59), IST)).toBe('2026-10-20'); // 23:59 local
  });

  it('handles the year boundary', () => {
    expect(dayKeyOf(Date.UTC(2026, 11, 31, 23, 30), IST)).toBe('2026-12-31'); // 02:30 on Jan 1st
    expect(dayKeyOf(Date.UTC(2027, 0, 1, 1, 0), IST)).toBe('2027-01-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(diffDays('2026-12-25', '2027-01-05')).toBe(11);
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
  });

  it('day bounds are 23h / 25h long around DST changes', () => {
    // New York: spring forward 2026-03-08, fall back 2026-11-01.
    expect(dayEndMs('2026-03-07', NY) - dayStartMs('2026-03-07', NY)).toBe(23 * H);
    expect(dayEndMs('2026-03-08', NY) - dayStartMs('2026-03-08', NY)).toBe(24 * H);
    expect(dayEndMs('2026-10-31', NY) - dayStartMs('2026-10-31', NY)).toBe(25 * H);
    // Berlin: 2026-03-29 and 2026-10-25.
    expect(dayStartMs('2026-03-29', BER)).toBe(Date.UTC(2026, 2, 29, 2)); // 04:00 CEST
    expect(dayStartMs('2026-10-25', BER)).toBe(Date.UTC(2026, 9, 25, 3)); // 04:00 CET
  });

  it('every instant falls inside the bounds of its own day (DST weeks)', () => {
    for (const cfg of [NY, BER, IST, { timezone: 'America/New_York', day_start_hour: 2 }]) {
      for (let t = Date.UTC(2026, 2, 5); t < Date.UTC(2026, 2, 31); t += 17 * 60_000) {
        const b = dayBounds(t, cfg);
        expect(t).toBeGreaterThanOrEqual(b.start);
        expect(t).toBeLessThan(b.end);
      }
      for (let t = Date.UTC(2026, 9, 22); t < Date.UTC(2026, 10, 4); t += 17 * 60_000) {
        const b = dayBounds(t, cfg);
        expect(t).toBeGreaterThanOrEqual(b.start);
        expect(t).toBeLessThan(b.end);
      }
    }
  });

  it('a start hour inside a DST gap resolves to the first instant after the gap', () => {
    // 02:00 does not exist in New York on 2026-03-08; 03:00 EDT = 07:00 UTC.
    expect(zonedTimeToUtc('2026-03-08', 2, 'America/New_York')).toBe(Date.UTC(2026, 2, 8, 7));
  });

  it('weekday and range helpers', () => {
    expect(weekdayMon0('2026-10-19')).toBe(0); // Monday
    expect(weekdayMon0('2026-10-25')).toBe(6); // Sunday
    expect(dayRange('2026-12-30', '2027-01-02')).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  });
});

describe('repeated wall hour (DST fall-back) as the day start', () => {
  it('starts the day at the first occurrence, so bounds and dayKeyOf agree', () => {
    const zones: [string, number][] = [
      ['Europe/Berlin', 2], // 2026-10-25 02:00–03:00 happens twice
      ['Asia/Beirut', 23],
      ['America/New_York', 1],
      ['Europe/Istanbul', 4],
    ];
    for (const [timezone, day_start_hour] of zones) {
      const cfg = { timezone, day_start_hour };
      for (let k = '2026-01-01'; k <= '2026-12-31'; k = addDays(k, 1)) {
        const start = dayStartMs(k, cfg);
        const end = dayEndMs(k, cfg);
        expect([dayKeyOf(start, cfg), dayKeyOf(end - 1, cfg)], `${timezone} ${k}`).toEqual([k, k]);
      }
    }
  });
});

describe('wallClock offset cache (v0.5.2 perf)', () => {
  it('matches Intl on every quarter hour around DST changes', () => {
    const fmt = (tz: string) =>
      new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    for (const tz of ['Europe/Berlin', 'America/New_York', 'Australia/Lord_Howe', 'Asia/Kathmandu', 'Europe/Istanbul']) {
      const f = fmt(tz);
      for (const from of [Date.UTC(2026, 2, 28), Date.UTC(2026, 9, 24), Date.UTC(2026, 3, 4), Date.UTC(2026, 10, 1)]) {
        for (let t = from; t < from + 3 * 86_400_000; t += 7 * 60_000 + 13_000) {
          const p = Object.fromEntries(f.formatToParts(new Date(t)).map((x) => [x.type, Number(x.value)]));
          const w = wallClock(t, tz);
          expect([w.year, w.month, w.day, w.hour, w.minute, w.second]).toEqual([p.year, p.month, p.day, p.hour! % 24, p.minute, p.second]);
        }
      }
    }
  });

  it('keeps 10 000 day keys cheap', () => {
    const cfg = { timezone: 'Europe/Istanbul', day_start_hour: 4 };
    const t0 = performance.now();
    for (let i = 0; i < 10_000; i++) dayKeyOf(Date.UTC(2026, 0, 1) + i * 3_600_000 * 7, cfg);
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});
