import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { makeCard, makeLog, makeSense } from '../test/factories';
import { createScheduler } from './fsrs';
import {
  becameLeech,
  canSplitSenses,
  isLeech,
  lapsesFromLogs,
  LEECH_LAPSES,
  listLeeches,
  primaryRecognition,
  splitTargets,
} from './leech';
import { replayCard } from './recompute';
import { Rating, type RatingValue, type ReviewLog } from './types';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 1);

/** Logs that take a card to Review and then forget it `lapses` times (each followed by relearning). */
function leechLogs(cardId: string, lapses: number, start = T0): ReviewLog[] {
  const logs: ReviewLog[] = [];
  let t = start;
  const add = (rating: RatingValue) => {
    logs.push(makeLog({ card_id: cardId, rating, reviewed_at: t }));
    t += 2 * DAY;
  };
  add(Rating.Easy); // New -> Review
  for (let i = 0; i < lapses; i++) {
    add(Rating.Again); // Review -> Relearning (a lapse)
    add(Rating.Easy); // back to Review
  }
  return logs;
}

describe('lapsesFromLogs', () => {
  it('counts Again answers given in Review, and only those', () => {
    const logs = leechLogs('c1', 3);
    expect(lapsesFromLogs(logs)).toBe(3);
    // Again while learning is not a lapse.
    const learning = [makeLog({ card_id: 'c2', rating: Rating.Again, reviewed_at: T0 })];
    expect(lapsesFromLogs(learning)).toBe(0);
  });

  it('is undo-aware: an undone Again is not a lapse', () => {
    const logs = leechLogs('c1', LEECH_LAPSES);
    expect(isLeech(lapsesFromLogs(logs))).toBe(true);
    const lastAgain = logs.filter((l) => l.rating === Rating.Again).at(-1)!;
    const undo = makeLog({ card_id: 'c1', rating: lastAgain.rating, reviewed_at: lastAgain.reviewed_at + 1, undo_of: lastAgain.id });
    expect(lapsesFromLogs([...logs, undo])).toBe(LEECH_LAPSES - 1);
    expect(isLeech(lapsesFromLogs([...logs, undo]))).toBe(false);
  });

  it('equals the lapses of the FSRS replay (invariant 3) for any history', () => {
    const scheduler = createScheduler({ request_retention: 0.9, fsrs_params: null });
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 1, max: 4 }), fc.integer({ min: 1, max: 6 * DAY })), { maxLength: 40 }),
        (steps) => {
          let t = T0;
          const logs = steps.map(([rating, gap]) => {
            t += gap;
            return makeLog({ card_id: 'p', rating: rating as RatingValue, reviewed_at: t });
          });
          const { fsrs } = replayCard(scheduler, { id: 'p', created_at: T0 }, logs);
          expect(lapsesFromLogs(logs)).toBe(fsrs.lapses);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('becameLeech', () => {
  it('flags only the answer that crosses the threshold', () => {
    const logs = leechLogs('c1', LEECH_LAPSES);
    const agains = logs.filter((l) => l.rating === Rating.Again);
    const sixth = agains[LEECH_LAPSES - 1]!;
    const upToSixth = logs.filter((l) => l.reviewed_at <= sixth.reviewed_at);
    expect(becameLeech(upToSixth, sixth.id)).toBe(true);
    const fifth = agains[LEECH_LAPSES - 2]!;
    expect(becameLeech(logs.filter((l) => l.reviewed_at <= fifth.reviewed_at), fifth.id)).toBe(false);
    // A seventh lapse does not flag again.
    const more = leechLogs('c1', LEECH_LAPSES + 1);
    const seventh = more.filter((l) => l.rating === Rating.Again).at(-1)!;
    expect(becameLeech(more, seventh.id)).toBe(false);
    expect(becameLeech(logs, 'unknown')).toBe(false);
  });
});

describe('listLeeches', () => {
  it('lists live, unsuspended leeches, most lapses first', () => {
    const a = makeCard({ note_id: 'n1' });
    const b = makeCard({ note_id: 'n2' });
    const suspended = makeCard({ note_id: 'n3', suspended: true });
    const deleted = makeCard({ note_id: 'n4', deleted_at: 1 });
    const few = makeCard({ note_id: 'n5' });
    const logs = new Map<string, ReviewLog[]>([
      [a.id, leechLogs(a.id, 6)],
      [b.id, leechLogs(b.id, 8)],
      [suspended.id, leechLogs(suspended.id, 9)],
      [deleted.id, leechLogs(deleted.id, 9)],
      [few.id, leechLogs(few.id, 5)],
    ]);
    const out = listLeeches([a, b, suspended, deleted, few], logs);
    expect(out.map((e) => [e.card_id, e.lapses])).toEqual([
      [b.id, 8],
      [a.id, 6],
    ]);
    expect(out[0]!.last_lapse_at).toBeGreaterThan(T0);
  });
});

describe('split and primary recognition', () => {
  const n = 'note';
  const s1 = makeSense({ note_id: n, sense_no: 1 });
  const s2 = makeSense({ note_id: n, sense_no: 2 });
  const rec = makeCard({ note_id: n });

  it('a recognition card of a multi-sense note can be split once per sense', () => {
    expect(canSplitSenses(rec, [s1, s2], [rec], 'word')).toBe(true);
    expect(canSplitSenses(rec, [s1], [rec], 'word')).toBe(false);
    expect(canSplitSenses(rec, [s1, s2], [rec], 'contrast')).toBe(false);
    const prod = makeCard({ note_id: n, sense_id: s1.id, card_type: 'production' });
    expect(canSplitSenses(prod, [s1, s2], [rec, prod], 'word')).toBe(false);
    const per1 = makeCard({ note_id: n, sense_id: s1.id });
    expect(splitTargets([s1, s2], [rec, per1])).toEqual([s2.id]);
    const per2 = makeCard({ note_id: n, sense_id: s2.id });
    expect(canSplitSenses(rec, [s1, s2], [rec, per1, per2], 'word')).toBe(false);
  });

  it('the note-level card stays primary after a split; a fresh copy takes over after a reset', () => {
    const suspendedRec = { ...rec, suspended: true };
    const per1 = makeCard({ note_id: n, sense_id: s1.id });
    expect(primaryRecognition([per1, suspendedRec])).toBe(suspendedRec);
    const fresh = makeCard({ note_id: n });
    expect(primaryRecognition([suspendedRec, per1, fresh])).toBe(fresh);
    expect(primaryRecognition([{ ...rec, deleted_at: 1 }, per1])).toBe(per1);
    expect(primaryRecognition([])).toBeUndefined();
  });
});
