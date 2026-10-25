import { describe, expect, it } from 'vitest';
import { makeCard } from '../test/factories';
import { buildQueue, isDayComplete, newCardsAllowed, type QueueContext } from './queue';
import { type Card, CardState } from './types';

const NOW = Date.UTC(2026, 9, 21, 9);
const DAY_END = Date.UTC(2026, 9, 22, 1);
const MIN = 60_000;

function ctx(p: Partial<QueueContext> = {}): QueueContext {
  return {
    now: NOW,
    dayEnd: DAY_END,
    dailyNewLimit: 10,
    newIntroducedToday: 0,
    reviewedTodayCardIds: new Set(),
    reviewedTodayNoteIds: new Set(),
    learnAheadMs: 0,
    ...p,
  };
}

const review = (id: string, due: number, note = `n-${id}`): Card =>
  makeCard({ id, note_id: note, state: CardState.Review, due });
const learning = (id: string, due: number, note = `n-${id}`): Card =>
  makeCard({ id, note_id: note, state: CardState.Learning, due });
const fresh = (id: string, created: number, note = `n-${id}`): Card =>
  makeCard({ id, note_id: note, created_at: created, due: created });

describe('buildQueue', () => {
  it('orders learning → reviews (oldest due first) and interleaves 1 new per 5 reviews', () => {
    const cards = [
      ...Array.from({ length: 12 }, (_, i) => review(`r${String(i).padStart(2, '0')}`, NOW - (i + 1) * MIN)),
      fresh('n1', 1),
      fresh('n2', 2),
      fresh('n3', 3),
      learning('l1', NOW - 5 * MIN),
      learning('l0', NOW - 10 * MIN),
    ];
    const q = buildQueue(cards, ctx());
    const ids = q.items.map((i) => i.card_id);
    expect(ids.slice(0, 2)).toEqual(['l0', 'l1']);
    // r11 is the most overdue.
    expect(ids.slice(2)).toEqual([
      'r11', 'r10', 'r09', 'r08', 'r07', 'n1',
      'r06', 'r05', 'r04', 'r03', 'r02', 'n2',
      'r01', 'r00', 'n3',
    ]);
    expect(q.counts).toMatchObject({ learning: 2, review: 12, new: 3, total: 17 });
  });

  it('respects the daily new limit minus cards already introduced today', () => {
    const cards = Array.from({ length: 15 }, (_, i) => fresh(`n${i}`, i));
    expect(buildQueue(cards, ctx()).counts.new).toBe(10);
    expect(buildQueue(cards, ctx({ newIntroducedToday: 7 })).counts.new).toBe(3);
    expect(buildQueue(cards, ctx({ newIntroducedToday: 12 })).counts.new).toBe(0);
    expect(buildQueue(cards, ctx({ dailyNewLimit: 20 })).counts.new).toBe(15);
  });

  it('keeps the 5:1 rhythm across rebuilds using session counts', () => {
    const cards = [...Array.from({ length: 8 }, (_, i) => review(`r${i}`, NOW - MIN * (10 - i))), fresh('n1', 1)];
    expect(buildQueue(cards, ctx({ session: { reviews: 4, new: 0 } })).items[1]!.card_id).toBe('n1');
    expect(buildQueue(cards, ctx({ session: { reviews: 5, new: 0 } })).items[0]!.card_id).toBe('n1');
  });

  it('appends new cards when reviews run out', () => {
    const q = buildQueue([review('r', NOW - MIN), fresh('a', 1), fresh('b', 2)], ctx());
    expect(q.items.map((i) => i.card_id)).toEqual(['r', 'a', 'b']);
  });

  it('excludes suspended, deleted and locked cards; reviews due after today', () => {
    const cards = [
      makeCard({ id: 's', note_id: 'a', state: CardState.Review, due: NOW - MIN, suspended: true }),
      makeCard({ id: 'd', note_id: 'b', state: CardState.Review, due: NOW - MIN, deleted_at: NOW }),
      makeCard({ id: 'l', note_id: 'c', card_type: 'production', unlocked: false }),
      review('tomorrow', DAY_END + MIN),
      review('later-today', DAY_END - MIN),
    ];
    expect(buildQueue(cards, ctx()).items.map((i) => i.card_id)).toEqual(['later-today']);
  });

  it('buries siblings: one card per note, and none for notes answered today', () => {
    const cards = [
      review('rec', NOW - 2 * MIN, 'X'),
      makeCard({ id: 'prod', note_id: 'X', card_type: 'production', state: CardState.Review, due: NOW - MIN }),
      fresh('newY', 1, 'Y'),
      review('revY', NOW - MIN, 'Y'),
      review('revZ', NOW - MIN, 'Z'),
      makeCard({ id: 'clozeZ', note_id: 'Z', card_type: 'cloze', state: CardState.Learning, due: NOW + 5 * MIN }),
    ];
    const ids = buildQueue(cards, ctx()).items.map((i) => i.card_id);
    expect(ids).toEqual(['rec', 'revY', 'revZ']);

    // revZ answered earlier today; its sibling in learning is buried, X's production too.
    const today = ctx({ reviewedTodayCardIds: new Set(['rec']), reviewedTodayNoteIds: new Set(['X', 'Z']), learnAheadMs: 20 * MIN });
    const ids2 = buildQueue(cards, today).items.map((i) => i.card_id);
    expect(ids2).toEqual(['rec', 'revY']);
  });

  it('learning cards re-enter once due; learn-ahead shows them at the end', () => {
    const cards = [learning('l', NOW + 5 * MIN), review('r', NOW - MIN), learning('far', NOW + 60 * MIN)];
    const q0 = buildQueue(cards, ctx());
    expect(q0.items.map((i) => i.card_id)).toEqual(['r']);
    expect(q0.nextLearningDue).toBe(NOW + 5 * MIN);
    const q1 = buildQueue(cards, ctx({ learnAheadMs: 20 * MIN }));
    expect(q1.items.map((i) => i.card_id)).toEqual(['r', 'l']);
    expect(q1.nextLearningDue).toBe(NOW + 60 * MIN);
    const q2 = buildQueue(cards, ctx({ now: NOW + 6 * MIN }));
    expect(q2.items[0]!.card_id).toBe('l');
  });

  it('builds a 1,000-card queue quickly', () => {
    const cards: Card[] = [];
    for (let i = 0; i < 10_000; i++) {
      cards.push(i % 3 === 0 ? fresh(`c${i}`, i) : review(`c${i}`, NOW - i * MIN));
    }
    const t0 = performance.now();
    const q = buildQueue(cards, ctx());
    expect(performance.now() - t0).toBeLessThan(200);
    expect(q.counts.new).toBe(10);
  });
});

describe('isDayComplete', () => {
  it('is false while a studied card is due before the day ends', () => {
    const c = ctx();
    expect(isDayComplete([fresh('n', 1)], c)).toBe(true);
    expect(isDayComplete([review('r', DAY_END - 1)], c)).toBe(false);
    expect(isDayComplete([review('r', DAY_END)], c)).toBe(true);
    expect(isDayComplete([learning('l', NOW + 10 * MIN)], c)).toBe(false);
  });
  it('excuses buried siblings and suspended cards', () => {
    const cards = [review('r', NOW - MIN, 'X'), makeCard({ id: 's', note_id: 'Y', state: 2, due: 0, suspended: true })];
    expect(isDayComplete(cards, ctx({ reviewedTodayNoteIds: new Set(['X']), reviewedTodayCardIds: new Set(['other']) }))).toBe(true);
  });
});

describe('extra new cards ("+5 yeni kart")', () => {
  const cards = Array.from({ length: 30 }, (_, i) => fresh(`n${String(i).padStart(2, '0')}`, i));

  it('adds exactly the allowance on top of the daily limit, minus what today already introduced', () => {
    // The daily 10 are done: only the extra 5 come.
    expect(buildQueue(cards, ctx({ newIntroducedToday: 10, extraNewToday: 5 })).counts.new).toBe(5);
    expect(buildQueue(cards, ctx({ newIntroducedToday: 10, extraNewToday: 15 })).counts.new).toBe(15);
    // Part of the allowance used: the rest is left, never more.
    expect(buildQueue(cards, ctx({ newIntroducedToday: 13, extraNewToday: 5 })).counts.new).toBe(2);
    expect(buildQueue(cards, ctx({ newIntroducedToday: 15, extraNewToday: 5 })).counts.new).toBe(0);
    // Not enough new cards: all that exist.
    expect(buildQueue(cards.slice(0, 3), ctx({ newIntroducedToday: 10, extraNewToday: 5 })).counts.new).toBe(3);
  });

  it('takes the next cards in creation order and ignores negative allowances', () => {
    const q = buildQueue(cards, ctx({ newIntroducedToday: 10, extraNewToday: 5 }));
    expect(q.items.map((i) => i.card_id)).toEqual(['n00', 'n01', 'n02', 'n03', 'n04']);
    expect(q.counts.new_allowed).toBe(5);
    expect(newCardsAllowed({ dailyNewLimit: 10, extraNewToday: -4, newIntroducedToday: 3 })).toBe(7);
  });
});

describe("review ahead (tomorrow's cards)", () => {
  const TOMORROW_END = DAY_END + 86_400_000;

  it('shows reviews due before the end of tomorrow, oldest due first, and no new cards', () => {
    const cards = [
      review('today', NOW - MIN),
      review('t2', DAY_END + 5 * MIN),
      review('t1', DAY_END + MIN),
      review('later', TOMORROW_END),
      fresh('n1', 1),
    ];
    const q = buildQueue(cards, ctx({ mode: 'ahead', aheadEnd: TOMORROW_END }));
    expect(q.items.map((i) => [i.card_id, i.kind])).toEqual([
      ['today', 'review'],
      ['t1', 'review'],
      ['t2', 'review'],
    ]);
    expect(q.counts.new).toBe(0);
    // The normal queue is unchanged by the same cards.
    expect(buildQueue(cards, ctx({ aheadEnd: TOMORROW_END })).items.map((i) => i.card_id)).toEqual(['today', 'n1']);
  });

  it('buries siblings of cards answered today and shows one card per note', () => {
    const cards = [review('a1', DAY_END + MIN, 'A'), review('a2', DAY_END + 2 * MIN, 'A'), review('b1', DAY_END + MIN, 'B')];
    const q = buildQueue(
      cards,
      ctx({ mode: 'ahead', aheadEnd: TOMORROW_END, reviewedTodayNoteIds: new Set(['B']), reviewedTodayCardIds: new Set(['x']) }),
    );
    expect(q.items.map((i) => i.card_id)).toEqual(['a1']);
  });

  it('keeps learning steps from an early Again in the session', () => {
    const cards = [learning('l', NOW + 5 * MIN), review('t1', DAY_END + MIN)];
    const q = buildQueue(cards, ctx({ mode: 'ahead', aheadEnd: TOMORROW_END, learnAheadMs: 20 * MIN }));
    expect(q.items.map((i) => [i.card_id, i.kind])).toEqual([
      ['t1', 'review'],
      ['l', 'learning'],
    ]);
  });

  it('does not change what counts as a completed day', () => {
    expect(isDayComplete([review('t1', DAY_END + MIN)], ctx())).toBe(true);
  });
});

describe('buildQueue study modes', () => {
  const typed = (c: Card, card_type: Card['card_type']): Card => ({ ...c, card_type });

  it('keeps only the mode card types', () => {
    const cards = [
      typed(review('rec', NOW - MIN, 'a'), 'recognition'),
      typed(review('prod', NOW - MIN, 'b'), 'production'),
      typed(review('img', NOW - MIN, 'c'), 'image'),
      typed(review('clz', NOW - MIN, 'd'), 'cloze'),
    ];
    const ids = (types: Card['card_type'][]) =>
      buildQueue(cards, ctx({ cardTypes: types })).items.map((i) => i.card_id).sort();
    expect(ids(['recognition'])).toEqual(['rec']);
    expect(ids(['production', 'image'])).toEqual(['img', 'prod']);
    expect(ids(['cloze'])).toEqual(['clz']);
  });

  it('never buries due cards; buries first-time cards whose recognition sibling was answered today', () => {
    const cards = [
      typed(review('prodDue', NOW - MIN, 'n1'), 'production'),
      typed(fresh('prodNew', 1, 'n2'), 'production'),
      typed(fresh('prodNew3', 2, 'n3'), 'production'),
    ];
    const q = buildQueue(
      cards,
      ctx({
        cardTypes: ['production', 'image'],
        reviewedTodayNoteIds: new Set(['n1', 'n2']),
        recognitionReviewedTodayNoteIds: new Set(['n1', 'n2']),
      }),
    );
    expect(q.items.map((i) => i.card_id)).toEqual(['prodDue', 'prodNew3']);
  });

  it('uses the mode first-time counter for the new limit', () => {
    const cards = Array.from({ length: 6 }, (_, i) => typed(fresh(`c${i}`, i), 'cloze'));
    expect(
      buildQueue(cards, ctx({ cardTypes: ['cloze'], dailyNewLimit: 5, newIntroducedToday: 2 })).counts.new,
    ).toBe(3);
  });
});
