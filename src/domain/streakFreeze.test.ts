import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addDays, type DayKey } from './day';
import { currentStreak } from './streak';
import {
  FREEZES_PER_MONTH,
  freezeNote,
  freezesLeftIn,
  type FreezeFacts,
  frozenDayRule,
  MAX_FREEZE_DAYS,
  parseFreezeDays,
  planFreezes,
  usedFreezeDays,
  withFreezeDays,
} from './streakFreeze';

const days = (from: DayKey, n: number) => Array.from({ length: n }, (_, i) => addDays(from, i));
const noVacation = () => false;

function facts(p: Partial<FreezeFacts> & { today: DayKey }): FreezeFacts {
  return { active: new Set(), isVacationDay: noVacation, freezeDays: [], ...p };
}

describe('planFreezes', () => {
  // Active 1–10 November, today the 12th: the 11th was missed.
  const active = new Set(days('2026-11-01', 10));

  it('covers one missed day', () => {
    expect(planFreezes(facts({ active, today: '2026-11-12' }))).toEqual(['2026-11-11']);
  });

  it('covers two missed days with the month’s two protections', () => {
    expect(planFreezes(facts({ active, today: '2026-11-13' }))).toEqual(['2026-11-11', '2026-11-12']);
  });

  it('three missed days: the streak ends and nothing is spent', () => {
    expect(planFreezes(facts({ active, today: '2026-11-14' }))).toEqual([]);
  });

  it('nothing to do when yesterday was active or today is the first day', () => {
    expect(planFreezes(facts({ active, today: '2026-11-11' }))).toEqual([]);
    expect(planFreezes(facts({ today: '2026-11-11' }))).toEqual([]);
  });

  it('one review today does not change what yesterday needs', () => {
    expect(planFreezes(facts({ active: new Set([...active, '2026-11-12']), today: '2026-11-12' }))).toEqual(['2026-11-11']);
  });

  it('a month that used both protections cannot cover a third day', () => {
    const used = ['2026-11-03', '2026-11-05'];
    const a = new Set(days('2026-11-01', 20).filter((d) => !used.includes(d)));
    expect(planFreezes(facts({ active: a, freezeDays: used, today: '2026-11-22' }))).toEqual([]);
  });

  it('a gap across two months uses each month’s own allowance', () => {
    const a = new Set(days('2026-10-20', 10)); // up to 29 October
    // Missed 30, 31 October and 1 November: October has two, November one.
    expect(planFreezes(facts({ active: a, today: '2026-11-02' }))).toEqual(['2026-10-30', '2026-10-31', '2026-11-01']);
    // A third October day is too many.
    const b = new Set(days('2026-10-20', 9)); // up to 28 October
    expect(planFreezes(facts({ active: b, today: '2026-11-01' }))).toEqual([]);
  });

  it('vacation days are skipped and never use a protection (no double counting)', () => {
    const vac = (d: DayKey) => d >= '2026-11-11' && d <= '2026-11-15';
    // Vacation 11–15, missed the 16th: one protection, for the 16th only.
    expect(planFreezes(facts({ active, isVacationDay: vac, today: '2026-11-17' }))).toEqual(['2026-11-16']);
    // Back on the 16th straight after the vacation: nothing to cover.
    expect(planFreezes(facts({ active, isVacationDay: vac, today: '2026-11-16' }))).toEqual([]);
  });

  it('days covered before are not covered again', () => {
    expect(planFreezes(facts({ active, freezeDays: ['2026-11-11'], today: '2026-11-12' }))).toEqual([]);
    expect(planFreezes(facts({ active, freezeDays: ['2026-11-11'], today: '2026-11-13' }))).toEqual(['2026-11-12']);
  });
});

describe('used protections', () => {
  const active = new Set(days('2026-11-01', 10));

  it('a covered day that became active (late sync) or a vacation day gives the protection back', () => {
    const all = ['2026-11-05', '2026-11-11', '2026-11-12'];
    const vac = (d: DayKey) => d === '2026-11-12';
    expect(usedFreezeDays({ active, isVacationDay: vac, freezeDays: all })).toEqual(['2026-11-11']);
    expect(freezesLeftIn(['2026-11-11'], '2026-11')).toBe(FREEZES_PER_MONTH - 1);
    expect(freezesLeftIn(['2026-10-30', '2026-10-31'], '2026-11')).toBe(FREEZES_PER_MONTH);
  });

  it('parseFreezeDays keeps valid, unique, sorted day keys', () => {
    expect(parseFreezeDays(['2026-11-12', 'x', 3, '2026-11-11', '2026-11-12'])).toEqual(['2026-11-11', '2026-11-12']);
    expect(parseFreezeDays(null)).toEqual([]);
    expect(parseFreezeDays({})).toEqual([]);
  });

  it('withFreezeDays merges and keeps the newest MAX_FREEZE_DAYS', () => {
    expect(withFreezeDays(['2026-11-11'], ['2026-11-12', '2026-11-11'])).toEqual(['2026-11-11', '2026-11-12']);
    const many = days('2024-01-01', MAX_FREEZE_DAYS + 5);
    const kept = withFreezeDays(many, []);
    expect(kept).toHaveLength(MAX_FREEZE_DAYS);
    expect(kept.at(-1)).toBe(many.at(-1));
  });
});

describe('the streak with protections', () => {
  it('a covered day neither breaks nor extends the streak', () => {
    const active = new Set(days('2026-11-01', 10));
    const freezeDays = planFreezes(facts({ active, today: '2026-11-12' }));
    const rule = frozenDayRule({ isVacationDay: noVacation, freezeDays });
    expect(currentStreak(active, '2026-11-12', rule)).toBe(10);
    expect(currentStreak(new Set([...active, '2026-11-12']), '2026-11-12', rule)).toBe(11);
    expect(currentStreak(active, '2026-11-12')).toBe(0);
  });

  it('property: at most two protections a month, and only ever on missed, non-vacation days', () => {
    fc.assert(
      fc.property(
        fc.array(fc.boolean(), { minLength: 30, maxLength: 120 }),
        fc.array(fc.integer({ min: 0, max: 119 }), { maxLength: 10 }),
        (studied, vacationIdx) => {
          // Simulate opening the app every day and applying protections.
          const start = '2026-09-01';
          const vacation = new Set(vacationIdx.map((i) => addDays(start, i)));
          const isVacationDay = (d: DayKey) => vacation.has(d);
          const active = new Set<DayKey>();
          let freezeDays: DayKey[] = [];
          for (let i = 0; i < studied.length; i++) {
            const today = addDays(start, i);
            freezeDays = withFreezeDays(freezeDays, planFreezes({ active, isVacationDay, freezeDays, today }));
            if (studied[i]) active.add(today);
          }
          const used = usedFreezeDays({ active, isVacationDay, freezeDays });
          const perMonth = new Map<string, number>();
          for (const d of used) perMonth.set(d.slice(0, 7), (perMonth.get(d.slice(0, 7)) ?? 0) + 1);
          for (const n of perMonth.values()) expect(n).toBeLessThanOrEqual(FREEZES_PER_MONTH);
          for (const d of freezeDays) {
            expect(active.has(d)).toBe(false);
            expect(vacation.has(d)).toBe(false);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('freezeNote', () => {
  const active = new Set(days('2026-11-01', 10));

  it('shows on the day after the covered day, with what is left, until closed', () => {
    const f = facts({ active, freezeDays: ['2026-11-11'], today: '2026-11-12' });
    expect(freezeNote(f, null)).toEqual({ covered: 1, left: 1, day: '2026-11-11' });
    expect(freezeNote(f, '2026-11-11')).toBeNull();
    expect(freezeNote({ ...f, today: '2026-11-13' }, null)).toBeNull();
  });

  it('counts the whole gap and says when the month has none left', () => {
    const f = facts({ active, freezeDays: ['2026-11-11', '2026-11-12'], today: '2026-11-13' });
    expect(freezeNote(f, null)).toEqual({ covered: 2, left: 0, day: '2026-11-12' });
  });

  it('nothing when no protection was used', () => {
    expect(freezeNote(facts({ active, today: '2026-11-11' }), null)).toBeNull();
  });
});
