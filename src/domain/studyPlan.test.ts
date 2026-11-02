import { describe, expect, it } from 'vitest';
import { distinctIntervalParts } from './fsrs';
import { trInterval } from '../test/intervalTr';

const distinctIntervalLabels = (ms: number[]) => distinctIntervalParts(ms).map(trInterval);
import { ANSWERS_PER_NEW, answersLeft, fairShares, minutesFor, planToday, shareNewBudget, shareReviewBudget } from './studyPlan';

const DAY = 86_400_000;

describe('planToday (ADR 0055)', () => {
  it('counts every mode and names the first one with cards', () => {
    const plan = planToday(
      {
        word: { review: 0, learning: 0, fresh: 0 },
        production: { review: 20, learning: 0, fresh: 9 },
        cloze: { review: 28, learning: 0, fresh: 0 },
      },
      10,
    );
    expect(plan.left).toBe(57);
    expect(plan.next).toBe('production');
    expect(plan.waiting).toEqual(['production', 'cloze']);
  });

  it('estimates with the learning steps of new cards', () => {
    // 15 new words at 10 s: 15 × 2.5 answers = 37.5 answers → 7 minutes, not 3.
    expect(answersLeft({ review: 0, learning: 0, fresh: 15 })).toBe(15 * ANSWERS_PER_NEW);
    expect(planToday({ word: { review: 0, learning: 0, fresh: 15 } }, 10).minutes).toBe(7);
    expect(minutesFor(0, 10)).toBe(0);
    expect(minutesFor(1, 10)).toBe(1);
  });

  it('is done when nothing is left', () => {
    const plan = planToday({ word: { review: 0, learning: 0, fresh: 0 } }, 10);
    expect(plan).toMatchObject({ left: 0, minutes: 0, next: null });
  });
});

describe('fairShares', () => {
  it('splits evenly and hands unused shares on', () => {
    expect(fairShares(10, { word: 100, production: 100, cloze: 100, dictation: 100 })).toEqual({ word: 3, production: 3, cloze: 2, dictation: 2 });
    expect(fairShares(10, { word: 100, production: 1 })).toEqual({ word: 9, production: 1, cloze: 0, dictation: 0 });
    expect(fairShares(10, { word: 3 })).toEqual({ word: 3, production: 0, cloze: 0, dictation: 0 });
    expect(fairShares(10, { word: 100, production: 100 }, { word: 2 })).toEqual({ word: 7, production: 3, cloze: 0, dictation: 0 });
  });
});

describe('shareNewBudget (ADR 0062)', () => {
  const plenty = { word: 50, production: 50, cloze: 50, dictation: 50 };
  it('never gives more than the total over all modes', () => {
    const a = shareNewBudget({ total: 10, introduced: {}, available: plenty });
    expect(Object.values(a).reduce((x, y) => x + y, 0)).toBe(10);
    expect(a.word).toBe(4);
  });
  it('gives a new user the whole budget in Kelime', () => {
    expect(shareNewBudget({ total: 10, introduced: {}, available: { word: 30 } }).word).toBe(10);
  });
  it('keeps the split over the day: a mode studied first does not take the others share', () => {
    const later = shareNewBudget({ total: 10, introduced: { word: 4 }, available: { word: 46, production: 50, cloze: 50, dictation: 50 } });
    expect(later.word).toBe(0);
    expect(later.production + later.cloze + later.dictation).toBe(6);
  });
  it('honours the per-mode limits and the extra allowance', () => {
    const a = shareNewBudget({ total: 10, introduced: {}, available: plenty, caps: { production: 0, cloze: 1, dictation: 0 } });
    expect(a).toEqual({ word: 9, production: 0, cloze: 1, dictation: 0 });
    const b = shareNewBudget({ total: 0, introduced: {}, available: { cloze: 7 }, extra: { cloze: 5 } });
    expect(b.cloze).toBe(5);
  });
  it('stops at the total even when modes went over their share earlier', () => {
    const a = shareNewBudget({ total: 10, introduced: { word: 9 }, available: plenty });
    expect(Object.values(a).reduce((x, y) => x + y, 0)).toBe(1);
  });
});

describe('shareReviewBudget (ADR 0062)', () => {
  it('gives every mode a fair part of the catch-up budget', () => {
    const due = { word: 300, production: 60, cloze: 40 };
    const s = shareReviewBudget(90, {}, due)!;
    expect(s).toEqual({ word: 30, production: 30, cloze: 30, dictation: 0 });
  });
  it('passes unused shares on and counts what was done today', () => {
    expect(shareReviewBudget(80, {}, { word: 300, production: 5 })).toEqual({ word: 75, production: 5, cloze: 0, dictation: 0 });
    // Kelime did 30 of 90 already: its share is 45, the rest goes to Üretim.
    expect(shareReviewBudget(60, { word: 30 }, { word: 300, production: 100 })).toEqual({ word: 15, production: 45, cloze: 0, dictation: 0 });
    expect(shareReviewBudget(null, {}, { word: 1 })).toBeNull();
  });
});

describe('distinctIntervalLabels', () => {
  it('never gives two buttons the same label', () => {
    const labels = distinctIntervalLabels([10 * 60_000, 58 * DAY, 62 * DAY, 90 * DAY]);
    expect(labels).toEqual(['10 dk', '58 gün', '62 gün', '3 ay']);
  });
  it('keeps the normal labels when they differ', () => {
    expect(distinctIntervalLabels([60_000, 6 * 60_000, 10 * 60_000, 3 * DAY])).toEqual([
      '1 dk',
      '6 dk',
      '10 dk',
      '3 gün',
    ]);
  });
});
