import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  decidePush,
  pushSlot,
  userDayKey,
  type PushCandidate,
} from '../../supabase/functions/_shared/push-rule';
import { wallClock } from './day';
import {
  countBefore,
  decideAt,
  nextHourBoundary,
  nextReminder,
  planReminders,
  type ReminderInput,
} from './reminderSchedule';

const ZONES = [
  'Europe/Istanbul', // UTC+3, no DST
  'Europe/London', // DST (EU rules)
  'America/New_York', // DST (US rules)
  'Australia/Sydney', // DST, southern hemisphere
  'Asia/Kolkata', // +05:30
  'America/St_Johns', // −03:30 with DST
] as const;

// DST changes in 2026: US 8 Mar / 1 Nov, EU 29 Mar / 25 Oct, AU 5 Apr / 4 Oct.
const PIVOTS = [
  Date.UTC(2026, 2, 8, 7),
  Date.UTC(2026, 2, 29, 1),
  Date.UTC(2026, 3, 5, 3),
  Date.UTC(2026, 9, 4, 3),
  Date.UTC(2026, 9, 25, 1),
  Date.UTC(2026, 10, 1, 6),
  Date.UTC(2026, 6, 15, 12),
];

const H = 3_600_000;
const D = 86_400_000;

function base(over: Partial<PushCandidate> = {}): PushCandidate {
  return {
    timezone: 'Europe/Istanbul',
    day_start_hour: 4,
    notify: { enabled: true, mode: 'auto', hour: 19 },
    vacation: null,
    last_review_at: null,
    last_push_day: null,
    ...over,
  };
}

describe('nextReminder (examples, Istanbul = UTC+3)', () => {
  const now = Date.UTC(2026, 9, 20, 7); // 10:00 local, Tuesday
  const due = [now - D, now + 2 * H]; // two reviews due today

  it('plans today at the chosen hour when nothing was studied', () => {
    const r = nextReminder({ candidate: base(), dueTimes: due, secPerCard: 10, now });
    expect(r?.at).toBe(Date.UTC(2026, 9, 20, 16)); // 19:00 local
    expect(r?.day).toBe('2026-10-20');
    expect(r?.due).toBe(2);
    expect(r?.message.body).toBe('Bugün 2 kart tekrara hazır, yaklaşık 1 dk.');
    expect(r?.message.url).toBe('/review');
  });

  it('moves to tomorrow once the user studied today', () => {
    const r = nextReminder({
      candidate: base({ last_review_at: now - 60_000 }),
      dueTimes: due,
      secPerCard: null,
      now,
    });
    expect(r?.at).toBe(Date.UTC(2026, 9, 21, 16));
    expect(r?.day).toBe('2026-10-21');
  });

  it('never twice a day: a reminder already shown today moves it to tomorrow', () => {
    const r = nextReminder({
      candidate: base({ last_push_day: '2026-10-20' }),
      dueTimes: due,
      secPerCard: null,
      now,
    });
    expect(r?.day).toBe('2026-10-21');
  });

  it('skips vacation days and plans nothing when nothing is due', () => {
    const vac = nextReminder({
      candidate: base({ vacation: { start: '2026-10-20', end: '2026-10-22' } }),
      dueTimes: due,
      secPerCard: null,
      now,
    });
    expect(vac?.day).toBe('2026-10-23');
    expect(nextReminder({ candidate: base(), dueTimes: [], secPerCard: null, now })).toBeNull();
  });

  it('after the chosen hour fires shortly after now, never during quiet hours', () => {
    const evening = Date.UTC(2026, 9, 20, 17, 30); // 20:30 local
    expect(
      nextReminder({ candidate: base(), dueTimes: due, secPerCard: null, now: evening })?.at,
    ).toBe(evening + 60_000);
    const late = Date.UTC(2026, 9, 20, 19, 10); // 22:10 local: next is tomorrow 19:00
    expect(
      nextReminder({ candidate: base(), dueTimes: due, secPerCard: null, now: late })?.at,
    ).toBe(Date.UTC(2026, 9, 21, 16));
  });

  it('is off when the phone’s switch is off', () => {
    const off = base({ notify: { enabled: false, mode: 'auto', hour: 19 } });
    expect(nextReminder({ candidate: off, dueTimes: due, secPerCard: null, now })).toBeNull();
  });
});

describe('helpers', () => {
  it('counts due instants before a bound', () => {
    expect(countBefore([], 5)).toBe(0);
    expect(countBefore([1, 2, 2, 7], 2)).toBe(1);
    expect(countBefore([1, 2, 2, 7], 3)).toBe(3);
    expect(countBefore([1, 2, 2, 7], 100)).toBe(4);
  });

  it('finds the next local hour boundary in half-hour zones', () => {
    const t = Date.UTC(2026, 0, 10, 4, 10); // 09:40 in Kolkata
    const b = nextHourBoundary(t, 'Asia/Kolkata');
    expect(wallClock(b, 'Asia/Kolkata')).toMatchObject({ hour: 10, minute: 0, second: 0 });
    expect(b - t).toBe(20 * 60_000);
  });
});

const zone = fc.constantFrom(...ZONES);
const candidateArb = (now: number) =>
  fc
    .record({
      timezone: zone,
      day_start_hour: fc.oneof(fc.constant(4), fc.integer({ min: 0, max: 23 })),
      notify: fc.record({
        enabled: fc.constantFrom(true, true, true, true, false),
        mode: fc.constantFrom('auto' as const, 'fixed' as const),
        hour: fc.oneof(fc.constant(null), fc.integer({ min: 9, max: 21 })),
      }),
      reviewedAgo: fc.oneof(fc.constant(null), fc.integer({ min: 0, max: 3 * D })),
      pushedDayShift: fc.oneof(fc.constant(null), fc.integer({ min: -1, max: 1 })),
      vacationShift: fc.oneof(
        fc.constant(null),
        fc.tuple(fc.integer({ min: -1, max: 2 }), fc.integer({ min: 0, max: 2 })),
      ),
      due: fc.array(fc.integer({ min: -2 * D, max: 4 * D }), { maxLength: 6 }),
    })
    .map((r) => {
      const shift = (n: number) => userDayKey(now + n * D, r.timezone, r.day_start_hour);
      const candidate: PushCandidate = {
        timezone: r.timezone,
        day_start_hour: r.day_start_hour,
        notify: r.notify,
        last_review_at: r.reviewedAgo === null ? null : now - r.reviewedAgo,
        last_push_day: r.pushedDayShift === null ? null : shift(r.pushedDayShift),
        vacation:
          r.vacationShift === null
            ? null
            : {
                start: shift(r.vacationShift[0]),
                end: shift(r.vacationShift[0] + r.vacationShift[1]),
              },
      };
      return { candidate, dueTimes: r.due.map((d) => now + d).sort((a, b) => a - b) };
    });

const nowArb = fc
  .tuple(fc.constantFrom(...PIVOTS), fc.integer({ min: -3 * D, max: 3 * D }))
  .map(([p, off]) => p + off);

describe('nextReminder equals decidePush (property, 6 time zones incl. DST)', () => {
  it('plans exactly the first instant at which decidePush would send', () => {
    fc.assert(
      fc.property(
        nowArb.chain((now) => candidateArb(now).map((c) => ({ now, ...c }))),
        fc.integer({ min: 0, max: 9 * 60_000 }),
        ({ now, candidate, dueTimes }, jitter) => {
          const input: ReminderInput = { candidate, dueTimes, secPerCard: 12, now, horizonDays: 3 };
          const plan = nextReminder(input);
          const start = now + 60_000;
          const end = plan ? plan.at : now + 3 * D;

          if (plan) {
            // It sends at the planned instant, with the same answer as the shared rule.
            const slot = pushSlot(candidate, plan.at);
            expect(slot.ok).toBe(true);
            const due = slot.ok ? countBefore(dueTimes, slot.dayEnd) : 0;
            const d = decidePush(candidate, plan.at, due, 12);
            expect(d.send).toBe(true);
            expect(plan.due).toBe(due);
            if (d.send) {
              expect(plan.day).toBe(d.day);
              expect(plan.message).toEqual(d.message);
            }
            // And not one millisecond earlier (unless it is the first possible instant).
            if (plan.at > start) expect(decideAt(input, plan.at - 1).decision.send).toBe(false);
          }
          // Nowhere before the plan (or within the horizon when there is none) would it send.
          for (let t = start + jitter; t < end; t += 10 * 60_000)
            expect(decideAt(input, t).decision.send).toBe(false);
        },
      ),
      { numRuns: 80 },
    );
  }, 60_000);

  it('never plans inside quiet hours, on a studied day or twice for one day', () => {
    fc.assert(
      fc.property(
        nowArb.chain((now) => candidateArb(now).map((c) => ({ now, ...c }))),
        ({ now, candidate, dueTimes }) => {
          const plan = nextReminder({ candidate, dueTimes, secPerCard: null, now, horizonDays: 3 });
          if (!plan) return;
          const tz = candidate.timezone as string;
          const hour = wallClock(plan.at, tz).hour;
          expect(hour).toBeGreaterThanOrEqual(9);
          expect(hour).toBeLessThan(22);
          expect(plan.day).not.toBe(candidate.last_push_day);
          if (candidate.last_review_at !== null)
            expect(
              userDayKey(candidate.last_review_at, tz, candidate.day_start_hour as number),
            ).not.toBe(plan.day);
        },
      ),
      { numRuns: 200 },
    );
  }, 60_000);
});

describe('planReminders (the days after, if the app is not opened)', () => {
  it('one a day, each the rule’s answer given the one before was shown', () => {
    fc.assert(
      fc.property(
        nowArb.chain((now) => candidateArb(now).map((c) => ({ now, ...c }))),
        ({ now, candidate, dueTimes }) => {
          const input: ReminderInput = { candidate, dueTimes, secPerCard: 9, now, horizonDays: 10 };
          const plans = planReminders(input);
          expect(plans.length).toBeLessThanOrEqual(7);
          expect(plans[0] ?? null).toEqual(nextReminder(input));
          for (let i = 1; i < plans.length; i++) {
            const prev = plans[i - 1]!;
            const p = plans[i]!;
            expect(p.day > prev.day).toBe(true);
            expect(p.at).toBeGreaterThan(prev.at);
            const c = { ...candidate, last_push_day: prev.day };
            const slot = pushSlot(c, p.at);
            const due = slot.ok ? countBefore(dueTimes, slot.dayEnd) : 0;
            expect(decidePush(c, p.at, due, 9).send).toBe(true);
          }
        },
      ),
      { numRuns: 60 },
    );
  }, 60_000);

  it('Istanbul example: every evening at 19:00 while reviews wait', () => {
    const now = Date.UTC(2026, 9, 20, 7);
    const plans = planReminders({
      candidate: base(),
      dueTimes: [now - D],
      secPerCard: null,
      now,
    });
    expect(plans.map((p) => p.day)).toEqual([
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
      '2026-10-26',
    ]);
    expect(plans.every((p) => wallClock(p.at, 'Europe/Istanbul').hour === 19)).toBe(true);
  });
});
