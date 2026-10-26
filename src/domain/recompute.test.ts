import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyRating, createScheduler, emptyFsrs } from './fsrs';
import { deriveUnlocked, effectiveLogs, replayCard } from './recompute';
import { makeLog } from '../test/factories';
import { RAMP_EPOCH } from './fsrsConfig';
import { CardState, type CardStateValue, type RatingValue, type ReviewLog } from './types';

const sched = createScheduler({ request_retention: 0.9, fsrs_params: null });
const T = Date.UTC(2026, 0, 1, 9);
const card = { id: 'card-1', created_at: T - 1000 };

describe('effectiveLogs', () => {
  it('drops undo rows and the logs they cancel, dedupes and sorts', () => {
    const a = makeLog({ id: 'a', card_id: 'card-1', reviewed_at: T + 2 });
    const b = makeLog({ id: 'b', card_id: 'card-1', reviewed_at: T + 1 });
    const c = makeLog({ id: 'c', card_id: 'card-1', reviewed_at: T + 3 });
    const undoC = makeLog({ id: 'u', card_id: 'card-1', reviewed_at: T + 4, undo_of: 'c' });
    expect(effectiveLogs([a, c, undoC, b, a]).map((l) => l.id)).toEqual(['b', 'a']);
  });

  it('breaks reviewed_at ties by id', () => {
    const x = makeLog({ id: 'x2', card_id: 'card-1', reviewed_at: T });
    const y = makeLog({ id: 'x1', card_id: 'card-1', reviewed_at: T });
    expect(effectiveLogs([x, y]).map((l) => l.id)).toEqual(['x1', 'x2']);
  });
});

describe('replayCard', () => {
  it('matches answering live, step by step', () => {
    const ratings: RatingValue[] = [3, 3, 1, 3, 4, 2];
    let f = emptyFsrs(card.created_at);
    const logs: ReviewLog[] = [];
    let t = T;
    for (const r of ratings) {
      f = applyRating(sched, { id: card.id, ...f }, r, t);
      logs.push(makeLog({ card_id: card.id, reviewed_at: t, rating: r }));
      t = Math.max(f.due, t + 60_000);
    }
    expect(replayCard(sched, card, logs).fsrs).toEqual(f);
  });

  it('undo restores the previous state', () => {
    const l1 = makeLog({ card_id: card.id, reviewed_at: T, rating: 3 });
    const l2 = makeLog({ card_id: card.id, reviewed_at: T + 600_000, rating: 3 });
    const before = replayCard(sched, card, [l1]).fsrs;
    const undo = makeLog({ card_id: card.id, reviewed_at: T + 700_000, undo_of: l2.id });
    expect(replayCard(sched, card, [l1, l2, undo]).fsrs).toEqual(before);
    expect(replayCard(sched, card, []).fsrs).toEqual(emptyFsrs(card.created_at));
  });

  it('ignores logs of other cards', () => {
    const own = makeLog({ card_id: card.id, reviewed_at: T });
    const other = makeLog({ card_id: 'other', reviewed_at: T + 1, rating: 1 });
    expect(replayCard(sched, card, [own, other])).toEqual(replayCard(sched, card, [own]));
  });

  it('property: any permutation or duplication of the same logs yields the same card', () => {
    const logArb = fc
      .array(
        fc.record({
          offset: fc.integer({ min: 0, max: 400 * 86_400_000 }),
          rating: fc.constantFrom<RatingValue>(1, 2, 3, 4),
          undo: fc.boolean(),
        }),
        { minLength: 0, maxLength: 25 },
      )
      .map((specs) => {
        const logs: ReviewLog[] = [];
        specs.forEach((s, i) => {
          const log = makeLog({ id: `l${String(i).padStart(3, '0')}`, card_id: card.id, reviewed_at: T + s.offset, rating: s.rating });
          logs.push(log);
          if (s.undo) logs.push(makeLog({ id: `u${i}`, card_id: card.id, reviewed_at: T + s.offset + 1, undo_of: log.id }));
        });
        return logs;
      });
    fc.assert(
      fc.property(
        logArb.chain((logs) =>
          fc.tuple(
            fc.constant(logs),
            fc.shuffledSubarray(logs, { minLength: logs.length, maxLength: logs.length }),
            fc.array(fc.nat(Math.max(0, logs.length - 1)), { maxLength: 10 }),
          ),
        ),
        ([logs, shuffled, dupIdx]) => {
          const withDups = [...shuffled, ...(logs.length ? dupIdx.map((i) => logs[i]!) : [])];
          expect(replayCard(sched, card, withDups).fsrs).toEqual(replayCard(sched, card, logs).fsrs);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('deriveUnlocked', () => {
  it('recognition is always unlocked', () => {
    expect(deriveUnlocked({ card_type: 'recognition', state: 0, reps: 0 }, null)).toBe(true);
  });
  const after = RAMP_EPOCH + 86_400_000;
  const rec = (state: CardStateValue, ramp_step = 0, last_review: number | null = after) => ({ state, ramp_step, last_review });
  it('production/cloze unlock at Pekişiyor (ramp_step ≥ 1), not at graduation', () => {
    const fresh = { card_type: 'production' as const, state: CardState.New, reps: 0 };
    expect(deriveUnlocked(fresh, rec(CardState.New, 0, null))).toBe(false);
    expect(deriveUnlocked(fresh, rec(CardState.Learning))).toBe(false);
    expect(deriveUnlocked(fresh, rec(CardState.Review, 0))).toBe(false);
    expect(deriveUnlocked(fresh, rec(CardState.Review, 1))).toBe(true);
    expect(deriveUnlocked(fresh, rec(CardState.Review, 4))).toBe(true);
    // A lapse at Öğrenildi drops the counter to 1: the short relearning step keeps them open.
    expect(deriveUnlocked(fresh, rec(CardState.Relearning, 1))).toBe(true);
    // A lapse before Pekişiyor resets it to 0: unstudied cards wait for the next recall.
    expect(deriveUnlocked(fresh, rec(CardState.Relearning, 0))).toBe(false);
    expect(deriveUnlocked({ ...fresh, card_type: 'cloze' }, null)).toBe(false);
  });
  it('keeps the cards the old rule opened (Review before RAMP_EPOCH, not answered since)', () => {
    const fresh = { card_type: 'cloze' as const, state: CardState.New, reps: 0 };
    expect(deriveUnlocked(fresh, rec(CardState.Review, 0, RAMP_EPOCH - 1))).toBe(true);
    expect(deriveUnlocked(fresh, rec(CardState.Relearning, 0, RAMP_EPOCH - 1))).toBe(true);
    expect(deriveUnlocked(fresh, rec(CardState.Learning, 0, RAMP_EPOCH - 1))).toBe(false);
  });
  it('a card with its own history stays unlocked', () => {
    expect(deriveUnlocked({ card_type: 'cloze', state: CardState.Learning, reps: 1 }, rec(CardState.Learning))).toBe(true);
  });
});

describe('early review ("Yarının kartlarını şimdi çalış")', () => {
  const DAY = 86_400_000;

  /** Graduate a card to Review, then answer the next reviews `early` ms before they are due. */
  function live(early: number[], ratings: RatingValue[]) {
    let f = emptyFsrs(card.created_at);
    const logs: ReviewLog[] = [];
    let t = T;
    const answer = (rating: RatingValue) => {
      f = applyRating(sched, { id: card.id, ...f }, rating, t);
      logs.push(makeLog({ card_id: card.id, reviewed_at: t, rating }));
    };
    answer(3);
    t += 10 * 60_000;
    answer(3);
    for (const [i, rating] of ratings.entries()) {
      t = Math.max(t + 60_000, f.due - (early[i] ?? 0));
      answer(rating);
    }
    return { fsrs: f, logs };
  }

  it('an early answer replays to exactly the state the live answer wrote', () => {
    const { fsrs, logs } = live([DAY, DAY / 2, 0, DAY], [3, 3, 1, 3]);
    expect(replayCard(sched, card, logs).fsrs).toEqual(fsrs);
  });

  it('answering a day early grows stability less than answering on time (so the next interval is shorter)', () => {
    const onTime = live([0, 0], [3, 3]).fsrs;
    const early = live([0, DAY], [3, 3]).fsrs;
    expect(early.stability).toBeLessThan(onTime.stability);
  });

  it('property: any mix of early and on-time answers replays to the live state, in any log order', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: DAY }), { minLength: 1, maxLength: 12 }),
        fc.array(fc.constantFrom<RatingValue>(1, 2, 3, 4), { minLength: 1, maxLength: 12 }),
        fc.integer(),
        (early, ratings, seed) => {
          const { fsrs, logs } = live(early, ratings);
          const shuffled = [...logs].sort((a, b) => ((a.id.charCodeAt(a.id.length - 1) ^ seed) & 7) - ((b.id.charCodeAt(b.id.length - 1) ^ seed) & 7));
          expect(replayCard(sched, card, shuffled).fsrs).toEqual(fsrs);
        },
      ),
      { numRuns: 150 },
    );
  });
});
