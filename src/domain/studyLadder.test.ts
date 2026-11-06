// v0.5.3 study (ADR 0071): multiple-choice answers and the ramp (B2), the format ladder (B2),
// the suggested rating (B2, B6) and the pace thresholds (B6).
import { describe, expect, it } from 'vitest';
import { suggestRating } from './answerCheck';
import { cardFormat } from './formatLadder';
import { applyRating, CHOICE_MAX_RAMP, createScheduler, emptyFsrs } from './fsrs';
import { DEFAULT_MEDIAN_MS, isSlowAnswer, median, SLOW_FLOOR_MS, slowThresholds, type PaceSample } from './pace';
import { replayCard } from './recompute';
import { cardStage } from './stages';
import { CardState, type FsrsFields, Rating, type ReviewLog } from './types';

const DAY = 86_400_000;
const T = Date.UTC(2026, 10, 10, 10);
const sched = createScheduler({ request_retention: 0.9, fsrs_params: null }, { fuzz: false });

const reviewCard = (p: Partial<FsrsFields>): { id: string } & FsrsFields => ({
  id: 'c1',
  ...emptyFsrs(T - 60 * DAY),
  state: CardState.Review,
  reps: 6,
  last_review: T - 20 * DAY,
  due: T,
  scheduled_days: 20,
  elapsed_days: 20,
  difficulty: 5,
  ...p,
});

describe('multiple choice never moves a card to Öğrenildi (B2)', () => {
  it('a right pick at ramp step 2 stays at 2; a typed recall moves on to 3', () => {
    const card = reviewCard({ ramp_step: 2, stability: 30 });
    const typed = applyRating(sched, card, Rating.Good, T);
    expect(typed.ramp_step).toBeGreaterThanOrEqual(3);
    expect(cardStage(typed)).toBe('learned');
    const choice = applyRating(sched, card, Rating.Good, T, { choice: true });
    expect(choice.ramp_step).toBe(CHOICE_MAX_RAMP);
    expect(cardStage(choice)).toBe('consolidating');
    expect(choice.learned_at).toBeNull();
    // The memory model itself is the same: only the ramp counter is held.
    expect(choice.stability).toBe(typed.stability);
  });

  it('a pick does not push a card past Öğrenildi by stability alone', () => {
    const card = reviewCard({ ramp_step: 3, stability: 10 });
    expect(cardStage(card)).toBe('consolidating');
    const choice = applyRating(sched, card, Rating.Good, T, { choice: true });
    expect(cardStage(choice)).not.toBe('learned');
    expect(choice.learned_at).toBeNull();
  });

  it('a pick on a card already Öğrenildi keeps its counter', () => {
    const card = reviewCard({ ramp_step: 4, stability: 40, learned_at: T - 30 * DAY });
    const choice = applyRating(sched, card, Rating.Good, T, { choice: true });
    expect(choice.ramp_step).toBe(4);
  });

  it('a wrong pick (Again) resets as usual', () => {
    const card = reviewCard({ ramp_step: 2, stability: 30 });
    expect(applyRating(sched, card, Rating.Again, T, { choice: true }).ramp_step).toBe(0);
  });

  it('the replay reads answer_mode from the log, so live answers and replays agree', () => {
    const created = T - 40 * DAY;
    const log = (id: string, at: number, rating: ReviewLog['rating'], mode?: ReviewLog['answer_mode']): ReviewLog => ({
      id,
      user_id: null,
      card_id: 'c1',
      rating,
      reviewed_at: at,
      duration_ms: 4000,
      device_id: 'd',
      undo_of: null,
      shown_sense_id: null,
      created_at: at,
      hlc: id,
      ...(mode ? { answer_mode: mode } : {}),
    });
    const days = [0, 1, 4, 11, 25, 39];
    const typedLogs = days.map((d, i) => log(`l${i}`, created + d * DAY, Rating.Good));
    const choiceLogs = days.map((d, i) => log(`l${i}`, created + d * DAY, Rating.Good, i === 0 ? undefined : 'choice'));
    const typed = replayCard(sched, { id: 'c1', created_at: created }, typedLogs).fsrs;
    const choice = replayCard(sched, { id: 'c1', created_at: created }, choiceLogs).fsrs;
    expect(choice.ramp_step).toBeLessThanOrEqual(CHOICE_MAX_RAMP);
    expect(choice.learned_at).toBeNull();
    expect(typed.ramp_step).toBeGreaterThan(choice.ramp_step);
    // Step by step, the replay equals applying each answer live.
    let live = emptyFsrs(created);
    for (const l of choiceLogs)
      live = applyRating(sched, { id: 'c1', ...live }, l.rating, l.reviewed_at, { choice: l.answer_mode === 'choice' });
    expect(live).toEqual(choice);
  });
});

describe('format ladder (B2)', () => {
  it('young cards keep their cues; Öğrenildi and Kalıcı cards lose them', () => {
    expect(cardFormat({ state: CardState.Review, ramp_step: 1, stability: 5 })).toEqual({
      sentenceOnFront: true,
      sentenceAsHint: false,
      choicesAllowed: true,
    });
    expect(cardFormat({ state: CardState.New, ramp_step: 0, stability: 0 }).choicesAllowed).toBe(true);
    for (const c of [
      { state: CardState.Review, ramp_step: 3, stability: 20 },
      { state: CardState.Review, ramp_step: 6, stability: 120 },
    ]) {
      expect(cardFormat(c)).toEqual({ sentenceOnFront: false, sentenceAsHint: true, choicesAllowed: false });
    }
  });
});

describe('suggested rating (B2, B6)', () => {
  it('a right pick from choices suggests Zor; a typed one İyi', () => {
    expect(suggestRating('correct', false)).toBe(Rating.Good);
    expect(suggestRating('correct', false, { choice: true })).toBe(Rating.Hard);
    expect(suggestRating('wrong', false, { choice: true })).toBe(Rating.Again);
  });

  it('a very slow right answer suggests Zor', () => {
    expect(suggestRating('correct', false, { slow: true })).toBe(Rating.Hard);
    expect(suggestRating('synonym', false, { slow: true })).toBe(Rating.Hard);
    expect(suggestRating('wrong', false, { slow: true })).toBe(Rating.Again);
  });
});

describe('pace thresholds (B6)', () => {
  const samples = (type: PaceSample['card_type'], ms: number, n: number, rating: PaceSample['rating'] = Rating.Good) =>
    Array.from({ length: n }, () => ({ card_type: type, rating, duration_ms: ms }));

  it('is twice the median of passing answers once there are enough', () => {
    const t = slowThresholds([...samples('production', 10_000, 30), ...samples('production', 50_000, 30, Rating.Again)]);
    expect(t.production).toBe(20_000);
  });

  it('falls back to a default median, and never goes under the floor', () => {
    const t = slowThresholds(samples('recognition', 1_000, 40));
    expect(t.recognition).toBe(SLOW_FLOOR_MS);
    expect(t.dictation).toBe(2 * DEFAULT_MEDIAN_MS.dictation);
  });

  it('flags only answers above the threshold', () => {
    const t = slowThresholds([]);
    expect(isSlowAnswer(t.cloze + 1, 'cloze', t)).toBe(true);
    expect(isSlowAnswer(t.cloze, 'cloze', t)).toBe(false);
    expect(isSlowAnswer(null, 'cloze', t)).toBe(false);
    expect(isSlowAnswer(99_000, 'cloze', null)).toBe(false);
  });

  it('median', () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
});
