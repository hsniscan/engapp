import { describe, expect, it } from 'vitest';
import {
  activityBasics,
  FIRST_STEPS_ANSWERS,
  isProgressBeginner,
  newLimitAction,
  progressUnlocks,
  shouldNudgeGap,
  vocabularyFloor,
} from './progressView';

describe('progressive İlerleme', () => {
  it('counts all answers and the last 30 days of review answers', () => {
    const day = (date: string, reviews: number, review_answers: number) => ({
      date,
      reviews,
      review_answers,
    });
    expect(
      activityBasics(
        [day('2026-09-01', 30, 10), day('2026-10-01', 5, 4), day('2026-10-26', 3, 2)],
        '2026-10-26',
      ),
    ).toEqual({ totalAnswers: 38, last30Answers: 6 });
  });

  it('a new user is a beginner until the first few answers', () => {
    expect(isProgressBeginner(0)).toBe(true);
    expect(isProgressBeginner(FIRST_STEPS_ANSWERS - 1)).toBe(true);
    expect(isProgressBeginner(FIRST_STEPS_ANSWERS)).toBe(false);
  });

  it('says what opens when, and how far away it is', () => {
    const u = progressUnlocks({
      totalAnswers: 4,
      last30Answers: 4,
      recognitionAnswers: 4,
      productionAnswers: 0,
      hasReport: false,
    });
    expect(u).toEqual([
      { key: 'stages', open: false, remaining: 6 },
      { key: 'recall', open: false, remaining: 16 },
      { key: 'gap', open: false, remaining: 20 },
      { key: 'report', open: false, remaining: 0 },
    ]);
    const all = progressUnlocks({
      totalAnswers: 500,
      last30Answers: 80,
      recognitionAnswers: 60,
      productionAnswers: 25,
      hasReport: true,
    });
    expect(all.every((x) => x.open && x.remaining === 0)).toBe(true);
  });
});

describe('no call to action when there is nothing to do', () => {
  it('gap practice: not at equal (rounded) rates, not when production is ahead', () => {
    expect(shouldNudgeGap({ recognitionRate: 0.912, productionRate: 0.908, noteCount: 7 })).toBe(
      false,
    );
    expect(shouldNudgeGap({ recognitionRate: 0.8, productionRate: 0.85, noteCount: 7 })).toBe(
      false,
    );
    expect(shouldNudgeGap({ recognitionRate: 0.92, productionRate: 0.85, noteCount: 7 })).toBe(
      true,
    );
    expect(shouldNudgeGap({ recognitionRate: 0.92, productionRate: 0.85, noteCount: 0 })).toBe(
      false,
    );
    // Overall comparison not ready yet, but single words show a clear gap: offer them.
    expect(shouldNudgeGap({ recognitionRate: null, productionRate: null, noteCount: 3 })).toBe(
      true,
    );
  });

  it('"Sınırı N yap" only lowers', () => {
    expect(newLimitAction(10, 6)).toBe('lower');
    expect(newLimitAction(6, 6)).toBe('done');
    expect(newLimitAction(4, 6)).toBe('already');
    expect(newLimitAction(undefined, 6)).toBeNull();
  });
});

describe('vocabulary floor', () => {
  it('learned + "Biliyorum" words; nothing → null', () => {
    expect(vocabularyFloor(231, 0)).toBe(231);
    expect(vocabularyFloor(231, 19)).toBe(250);
    expect(vocabularyFloor(0, 0)).toBeNull();
  });
});
