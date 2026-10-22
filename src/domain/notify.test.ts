import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { userDayBounds, userDayKey } from '../../supabase/functions/_shared/push-rule';
import { dayBounds, dayKeyOf } from './day';
import { autoNotifyHour, DEFAULT_NOTIFY_HOUR, resolveNotify } from './notify';

const IST = 'Europe/Istanbul';
const NOW = Date.parse('2026-10-23T12:00:00+03:00');
const at = (daysAgo: number, hour: number, minute = 0) =>
  Date.parse(
    `2026-10-23T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+03:00`,
  ) -
  daysAgo * 86_400_000;

describe('autoNotifyHour', () => {
  it('is the most common session start hour of the last 21 days', () => {
    const logs = [
      // three evenings starting at 20:xx, each a session of several answers
      at(1, 20, 5),
      at(1, 20, 6),
      at(1, 20, 40),
      at(1, 21, 1),
      at(2, 20, 30),
      at(2, 20, 31),
      at(3, 20, 59),
      at(3, 21, 20),
      // two mornings at 08:xx (clamped would be 09, but 20 wins anyway)
      at(4, 8, 0),
      at(5, 8, 10),
    ];
    expect(autoNotifyHour(logs, IST, NOW)).toBe(20);
  });

  it('counts a session once, however long it is', () => {
    const long = Array.from({ length: 40 }, (_, i) => at(1, 10, 0) + i * 60_000); // 10:00–10:39
    expect(autoNotifyHour([...long, at(2, 18), at(3, 18)], IST, NOW)).toBe(18);
  });

  it('ignores history older than 21 days and breaks ties to the earlier hour', () => {
    const old = [at(25, 13), at(26, 13), at(27, 13)];
    expect(autoNotifyHour([...old, at(1, 17), at(2, 15)], IST, NOW)).toBe(15);
  });

  it('keeps the hour between 09 and 21, with a default when there is no history', () => {
    expect(autoNotifyHour([at(1, 6), at(2, 6)], IST, NOW)).toBe(9);
    expect(autoNotifyHour([at(1, 23, 30), at(2, 23)], IST, NOW)).toBe(21);
    expect(autoNotifyHour([], IST, NOW)).toBe(DEFAULT_NOTIFY_HOUR);
  });

  it('uses the user time zone', () => {
    const utc18 = [Date.parse('2026-10-22T18:00:00Z'), Date.parse('2026-10-21T18:10:00Z')];
    expect(autoNotifyHour(utc18, 'UTC', NOW)).toBe(18);
    expect(autoNotifyHour(utc18, IST, NOW)).toBe(21);
  });
});

describe('resolveNotify', () => {
  it('stores the automatic hour in auto mode and the chosen one in fixed mode', () => {
    expect(resolveNotify(null, { enabled: true }, 20)).toEqual({
      enabled: true,
      mode: 'auto',
      hour: 20,
    });
    const on = { enabled: true, mode: 'auto', hour: 20 };
    expect(resolveNotify(on, { mode: 'fixed', hour: 8 }, 20)).toEqual({
      enabled: true,
      mode: 'fixed',
      hour: 9,
    });
    expect(resolveNotify({ enabled: true, mode: 'fixed', hour: 12 }, {}, 20)).toEqual({
      enabled: true,
      mode: 'fixed',
      hour: 12,
    });
    expect(resolveNotify({ enabled: true, mode: 'fixed', hour: 12 }, { mode: 'auto' }, 19)).toEqual(
      { enabled: true, mode: 'auto', hour: 19 },
    );
    expect(resolveNotify(on, { enabled: false }, 20)).toEqual({
      enabled: false,
      mode: 'auto',
      hour: 20,
    });
  });
});

describe('the server copy of the day rule', () => {
  it('agrees with src/domain/day.ts in every zone and at every instant', () => {
    const zones = [
      'Europe/Istanbul',
      'Europe/Berlin',
      'America/New_York',
      'Australia/Lord_Howe',
      'Asia/Kolkata',
      'UTC',
    ];
    fc.assert(
      fc.property(
        fc.integer({ min: Date.UTC(2025, 0, 1), max: Date.UTC(2028, 0, 1) }),
        fc.constantFrom(...zones),
        fc.integer({ min: 0, max: 12 }),
        (ms, timezone, day_start_hour) => {
          const cfg = { timezone, day_start_hour };
          expect(userDayKey(ms, timezone, day_start_hour)).toBe(dayKeyOf(ms, cfg));
          const b = dayBounds(ms, cfg);
          expect(userDayBounds(ms, timezone, day_start_hour)).toEqual({
            day: b.key,
            start: b.start,
            end: b.end,
          });
        },
      ),
      { numRuns: 400 },
    );
  });
});
