// Acceptance criterion 8 measurement (v0.4 İP8): recall of the English word for senses with a
// picture card against senses without one (domain/retention.ts pictureRecallComparison).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { makeLog } from '../test/factories';
import type { DayConfig } from './day';
import {
  collectRetention,
  makeDayOf,
  MIN_ANSWERS,
  pictureRecallComparison,
  type RetentionCardFacts,
} from './retention';
import type { CardType, ReviewLog } from './types';

const CFG: DayConfig = { timezone: 'Europe/Istanbul', day_start_hour: 4 };
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 1, 9);
const dayOf = makeDayOf(CFG);

function facts(card_type: CardType, sense_id: string | null): RetentionCardFacts {
  return { note_id: `n-${sense_id}`, card_type, term_type: 'word', level: null, topics: [], sources: [], pos: [], sense_id };
}

/** A card that graduates on day 0 (Easy) and is then answered once a day: true = remembered. */
function history(cardId: string, results: boolean[]): ReviewLog[] {
  const logs = [makeLog({ card_id: cardId, reviewed_at: T0, rating: 4 })];
  results.forEach((ok, i) => {
    const at = T0 + (i + 1) * DAY;
    logs.push(makeLog({ card_id: cardId, reviewed_at: at, rating: ok ? 3 : 1 }));
    if (!ok) logs.push(makeLog({ card_id: cardId, reviewed_at: at + 600_000, rating: 3 }));
  });
  return logs;
}

const results = (passed: number, failed: number) => [...Array<boolean>(passed).fill(true), ...Array<boolean>(failed).fill(false)];

describe('pictureRecallComparison', () => {
  it('splits production answers by whether the sense has a picture card', () => {
    const f = new Map<string, RetentionCardFacts>([
      ['p-with', facts('production', 's-with')],
      ['img', facts('image', 's-with')],
      ['p-without', facts('production', 's-without')],
      ['rec', facts('recognition', null)],
      ['cloze', facts('cloze', 's-with')],
    ]);
    const data = collectRetention(
      [
        history('p-with', results(18, 2)),
        history('img', results(9, 1)),
        history('p-without', results(15, 5)),
        history('rec', results(5, 5)),
        history('cloze', results(0, 10)),
      ],
      dayOf,
    );
    const r = pictureRecallComparison(data, f);
    expect(r.pictureCards).toBe(1);
    expect(r.withPicture).toMatchObject({ n: 20, passed: 18, rate: 0.9, enough: true });
    expect(r.withoutPicture).toMatchObject({ n: 20, passed: 15, rate: 0.75, enough: true });
    expect(r.pictureAnswers).toMatchObject({ n: 10, passed: 9, enough: false });
    expect(r.diff).toBeCloseTo(0.15, 10);
  });

  it('gives no difference until both sides have enough answers', () => {
    const f = new Map([
      ['p-with', facts('production', 's1')],
      ['img', facts('image', 's1')],
      ['p-without', facts('production', 's2')],
    ]);
    const data = collectRetention([history('p-with', results(MIN_ANSWERS - 1, 0)), history('p-without', results(30, 0))], dayOf);
    const r = pictureRecallComparison(data, f);
    expect(r.withPicture.enough).toBe(false);
    expect(r.diff).toBeNull();
  });

  it('counts nothing without picture cards on the "with" side, and leaves out deleted cards', () => {
    const f = new Map([['p', facts('production', 's1')]]);
    const data = collectRetention([history('p', results(3, 1)), history('gone', results(5, 0))], dayOf);
    const r = pictureRecallComparison(data, f);
    expect(r.pictureCards).toBe(0);
    expect(r.withPicture.n).toBe(0);
    expect(r.withoutPicture.n).toBe(4);
  });

  it('respects the window', () => {
    const f = new Map([
      ['p', facts('production', 's1')],
      ['img', facts('image', 's1')],
    ]);
    const data = collectRetention([history('p', results(10, 0))], dayOf);
    expect(pictureRecallComparison(data, f, { from: T0 + 5.5 * DAY }).withPicture.n).toBe(5);
  });

  it('property: every counted production answer lands on exactly one side', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ picture: fc.boolean(), passed: fc.nat(6), failed: fc.nat(3) }), { maxLength: 6 }),
        (cards) => {
          const f = new Map<string, RetentionCardFacts>();
          const logs: ReviewLog[][] = [];
          cards.forEach((c, i) => {
            f.set(`p${i}`, facts('production', `s${i}`));
            if (c.picture) f.set(`i${i}`, facts('image', `s${i}`));
            logs.push(history(`p${i}`, results(c.passed, c.failed)));
          });
          const r = pictureRecallComparison(collectRetention(logs, dayOf), f);
          const total = cards.reduce((n, c) => n + c.passed + c.failed, 0);
          const withTotal = cards.filter((c) => c.picture).reduce((n, c) => n + c.passed + c.failed, 0);
          return r.withPicture.n + r.withoutPicture.n === total && r.withPicture.n === withTotal;
        },
      ),
    );
  });
});
