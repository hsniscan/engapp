import { describe, expect, it } from 'vitest';
import { addDays, dayBounds, dayEndMs, dayKeyOf, dayRange, dayStartMs, diffDays, weekdayMon0, zonedTimeToUtc } from './day';

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
