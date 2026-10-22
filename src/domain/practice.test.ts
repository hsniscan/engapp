import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { makeCard } from '../test/factories';
import {
  answerRound,
  countPracticeSources,
  currentCard,
  isRoundDone,
  type PracticeCandidate,
  type PracticeResult,
  seededShuffle,
  selectPracticeCards,
  startRound,
  summarizeRound,
} from './practice';
import { CardState } from './types';

const NOW = Date.UTC(2026, 9, 21, 9);
const DAY = 86_400_000;

function cand(
  id: string,
  p: Partial<PracticeCandidate> & {
    note?: string;
    difficulty?: number;
    lapses?: number;
    state?: 0 | 1 | 2 | 3;
  } = {},
): PracticeCandidate {
  return {
    card: makeCard({
      id,
      note_id: p.note ?? `n-${id}`,
      state: p.state ?? CardState.Review,
      reps: p.state === CardState.New ? 0 : 3,
      difficulty: p.difficulty ?? 5,
      lapses: p.lapses ?? 0,
    }),
    firstReviewAt: p.firstReviewAt ?? null,
    lastAgainAt: p.lastAgainAt ?? null,
    lastPracticeMissAt: p.lastPracticeMissAt ?? null,
    tags: p.tags ?? [],
  };
}

describe('selectPracticeCards', () => {
  it('"hard": lapses ≥ 2, difficulty ≥ 7, an Again or a practice miss in the last 14 days; recent misses first', () => {
    const cards = [
      cand('easy'),
      cand('lapsed', { lapses: 2 }),
      cand('difficult', { difficulty: 8 }),
      cand('again', { lastAgainAt: NOW - 3 * DAY }),
      cand('oldAgain', { lastAgainAt: NOW - 20 * DAY }),
      cand('missed', { lastPracticeMissAt: NOW - DAY }),
    ];
    const ids = selectPracticeCards(cards, { source: 'hard' }, { now: NOW, size: 10, seed: 's' });
    expect(new Set(ids)).toEqual(new Set(['lapsed', 'difficult', 'again', 'missed']));
    expect(ids.slice(0, 2).sort()).toEqual(['again', 'missed']);
  });

  it('"recent": the first answer is within the last 7 days', () => {
    const cards = [
      cand('new1', { firstReviewAt: NOW - DAY }),
      cand('old', { firstReviewAt: null }),
      cand('week', { firstReviewAt: NOW - 8 * DAY }),
    ];
    expect(
      selectPracticeCards(cards, { source: 'recent' }, { now: NOW, size: 10, seed: 's' }),
    ).toEqual(['new1']);
  });

  it('"tag": notes with the tag', () => {
    const cards = [
      cand('a', { tags: ['iş'] }),
      cand('b', { tags: ['ev'] }),
      cand('c', { tags: ['iş', 'ev'] }),
    ];
    expect(
      selectPracticeCards(
        cards,
        { source: 'tag', tag: 'iş' },
        { now: NOW, size: 10, seed: 's' },
      ).sort(),
    ).toEqual(['a', 'c']);
    expect(
      selectPracticeCards(cards, { source: 'tag', tag: null }, { now: NOW, size: 10, seed: 's' }),
    ).toEqual([]);
  });

  it('"list": the listed notes, the hardest card of each note', () => {
    const cards = [
      cand('rec', { note: 'n1', difficulty: 3 }),
      cand('prod', { note: 'n1', difficulty: 8 }),
      cand('other', { note: 'n2' }),
      cand('unlisted', { note: 'n3' }),
    ];
    const ids = selectPracticeCards(
      cards,
      { source: 'list', noteIds: new Set(['n1', 'n2']) },
      { now: NOW, size: 10, seed: 's' },
    );
    expect(ids).toEqual(['prod', 'other']);
  });

  it('skips new, suspended, locked and deleted cards', () => {
    const base = { lapses: 3 };
    const cards = [cand('ok', base), cand('new', { ...base, state: CardState.New })];
    cards.push({ ...cand('susp', base), card: { ...cand('susp', base).card, suspended: true } });
    cards.push({
      ...cand('locked', base),
      card: { ...cand('locked', base).card, unlocked: false },
    });
    cards.push({ ...cand('gone', base), card: { ...cand('gone', base).card, deleted_at: 1 } });
    expect(
      selectPracticeCards(cards, { source: 'hard' }, { now: NOW, size: 10, seed: 's' }),
    ).toEqual(['ok']);
  });

  it('takes at most `size` cards and one card per note (the hardest of the note)', () => {
    const cards = [
      cand('x1', { note: 'X', lapses: 2, difficulty: 7 }),
      cand('x2', { note: 'X', lapses: 5, difficulty: 9 }),
      ...Array.from({ length: 30 }, (_, i) => cand(`h${i}`, { lapses: 2 })),
    ];
    const ids = selectPracticeCards(cards, { source: 'hard' }, { now: NOW, size: 20, seed: 's' });
    expect(ids).toHaveLength(20);
    expect(ids[0]).toBe('x2');
    expect(ids).not.toContain('x1');
  });

  it('shuffles random sources with the seed: same seed, same order', () => {
    const cards = Array.from({ length: 20 }, (_, i) => cand(`r${i}`, { firstReviewAt: NOW - DAY }));
    const a = selectPracticeCards(cards, { source: 'recent' }, { now: NOW, size: 10, seed: 'one' });
    expect(
      selectPracticeCards(
        [...cards].reverse(),
        { source: 'recent' },
        { now: NOW, size: 10, seed: 'one' },
      ),
    ).toEqual(a);
    expect(
      selectPracticeCards(cards, { source: 'recent' }, { now: NOW, size: 10, seed: 'two' }),
    ).not.toEqual(a);
  });

  it('seededShuffle is a permutation', () => {
    fc.assert(
      fc.property(fc.array(fc.integer(), { maxLength: 40 }), fc.string(), (xs, seed) => {
        expect([...seededShuffle(xs, seed)].sort((a, b) => a - b)).toEqual(
          [...xs].sort((a, b) => a - b),
        );
      }),
    );
  });
});

describe('countPracticeSources', () => {
  it('counts notes per source and per tag', () => {
    const c = countPracticeSources(
      [
        cand('a1', { note: 'A', lapses: 2, tags: ['iş'] }),
        cand('a2', { note: 'A', difficulty: 9, tags: ['iş'] }),
        cand('b', { firstReviewAt: NOW - DAY, tags: ['iş', 'ev'] }),
        cand('c', { state: CardState.New, lapses: 4, tags: ['ev'] }),
      ],
      NOW,
    );
    expect(c.hard).toBe(1);
    expect(c.recent).toBe(1);
    expect(Object.fromEntries(c.tags)).toEqual({ iş: 2, ev: 1 });
  });
});

describe('practice round', () => {
  it('brings a missed card back once at the end', () => {
    let r = startRound(['a', 'b', 'c']);
    r = answerRound(r, 'unknown'); // a
    r = answerRound(r, 'known'); // b
    expect(r.queue.map((q) => q.card_id)).toEqual(['c', 'a']);
    r = answerRound(r, 'known'); // c
    expect(currentCard(r)).toEqual({ card_id: 'a', repeat: true });
    r = answerRound(r, 'unknown'); // a again: not repeated a third time
    expect(isRoundDone(r)).toBe(true);
    expect(summarizeRound(r)).toEqual({ cards: 3, knownFirstTry: 2, hardest: ['a'] });
  });

  it('ranks the hardest words: missed twice before missed once, then round order', () => {
    let r = startRound(['a', 'b', 'c', 'd']);
    for (const res of [
      'unknown',
      'unknown',
      'unknown',
      'known',
      'known',
      'unknown',
      'known',
    ] as PracticeResult[])
      r = answerRound(r, res);
    // a ✗, b ✗, c ✗, d ✓, a ✓, b ✗, c ✓
    expect(isRoundDone(r)).toBe(true);
    expect(summarizeRound(r).hardest).toEqual(['b', 'a', 'c']);
  });

  it('property: every card is shown once or twice and the round always ends', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 4 }), { maxLength: 20 }),
        fc.array(fc.boolean(), { maxLength: 60 }),
        (ids, answers) => {
          let r = startRound(ids);
          let i = 0;
          while (!isRoundDone(r))
            r = answerRound(r, answers[i++ % Math.max(1, answers.length)] ? 'known' : 'unknown');
          expect(r.answers.length).toBeLessThanOrEqual(ids.length * 2);
          const s = summarizeRound(r);
          expect(s.cards).toBe(ids.length);
          expect(s.knownFirstTry).toBeLessThanOrEqual(ids.length);
        },
      ),
    );
  });
});
