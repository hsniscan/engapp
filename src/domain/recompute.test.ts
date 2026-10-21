import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyRating, createScheduler, emptyFsrs } from './fsrs';
import { deriveUnlocked, effectiveLogs, replayCard } from './recompute';
import { makeLog } from '../test/factories';
import { CardState, type RatingValue, type ReviewLog } from './types';

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
  it('production/cloze unlock once recognition has reached Review', () => {
    const fresh = { card_type: 'production' as const, state: CardState.New, reps: 0 };
    expect(deriveUnlocked(fresh, CardState.New)).toBe(false);
    expect(deriveUnlocked(fresh, CardState.Learning)).toBe(false);
    expect(deriveUnlocked(fresh, CardState.Review)).toBe(true);
    expect(deriveUnlocked(fresh, CardState.Relearning)).toBe(true);
    expect(deriveUnlocked({ ...fresh, card_type: 'cloze' }, null)).toBe(false);
  });
  it('a card with its own history stays unlocked', () => {
    expect(deriveUnlocked({ card_type: 'cloze', state: CardState.Learning, reps: 1 }, CardState.Learning)).toBe(true);
  });
});
