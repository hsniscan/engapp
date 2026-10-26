import { describe, expect, it } from 'vitest';
import { distinctIntervalLabels } from './fsrs';
import { ANSWERS_PER_NEW, answersLeft, minutesFor, planToday, shareReviewCap } from './studyPlan';

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

describe('shareReviewCap', () => {
  it('gives the catch-up budget to the modes in order', () => {
    const due = { word: 80, production: 50, cloze: 30 };
    expect(shareReviewCap(100, due, 'word')).toBe(100);
    expect(shareReviewCap(100, due, 'production')).toBe(20);
    expect(shareReviewCap(100, due, 'cloze')).toBe(0);
    expect(shareReviewCap(null, due, 'cloze')).toBeNull();
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
