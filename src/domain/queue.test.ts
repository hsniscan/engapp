import { describe, expect, it } from 'vitest';
import { makeCard } from '../test/factories';
import { buildQueue, isDayComplete, type QueueContext } from './queue';
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
