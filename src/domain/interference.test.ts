// Interference guard (v0.5 İP10, docs/decisions/0052): at most one first-time card a day from
// one confusable pair, one Turkish meaning or one synonym set; postponed cards come first on
// a later day; the daily count is kept whenever another eligible card exists.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { makeCard } from '../test/factories';
import { pairKey } from './confusables';
import {
  interferenceKeys,
  type NewNoteFacts,
  type NewOrderInput,
  newOrderSeed,
  noteFacts,
  selectAddedCards,
  selectNewCards,
  synonymKey,
} from './newOrder';
import { buildQueue, type QueueContext } from './queue';
import { type Card, CardState, type LexiconSense } from './types';

const DAY = 86_400_000;
const DAY_START = Date.UTC(2026, 10, 2, 1);
const NOW = DAY_START + 5 * 3600_000;
const OLD = DAY_START - 60 * DAY;

function facts(id: string, p: Partial<NewNoteFacts> = {}): NewNoteFacts {
  return {
    note_id: id,
    term_norm: `term${id}`,
    term_type: 'word',
    created_at: OLD,
    cefr: 'B1',
    zipf: 4,
    manual: false,
    source_id: 'src',
    family: null,
    lemma: `term${id}`,
    meanings: [`anlam ${id}`],
    contrast: null,
    ...p,
  };
}

const short = (prefix: string, i: number) => `${prefix}${i.toString(36).padStart(3, '0')}`;
/** Mutually unconfusable words. */
const filler = (n: number) =>
  Array.from({ length: n }, (_, i) => facts(`f${String(i).padStart(3, '0')}`, { term_norm: short('w', i), lemma: short('w', i), zipf: 3 }));

function input(list: NewNoteFacts[], p: Partial<NewOrderInput> = {}): NewOrderInput {
  return {
    level: 'B1',
    seed: newOrderSeed('user-a', '2026-11-02'),
    dayStart: DAY_START,
    notes: new Map(list.map((f) => [f.note_id, f])),
    activeSources: new Set(),
    pairs: new Set(),
    introducedToday: [],
    ...p,
  };
}

const cardOf = (f: NewNoteFacts, i = 0): Card =>
  makeCard({ id: `c-${f.note_id}`, note_id: f.note_id, created_at: f.created_at + i });
const run = (list: NewNoteFacts[], limit: number, p: Partial<NewOrderInput> = {}) => {
  const sel = selectNewCards(list.map((f, i) => cardOf(f, i)), limit, () => false, input(list, p));
  return { notes: sel.cards.map((c) => c.note_id), postponed: sel.postponed };
};

const W = (id: string, term: string, p: Partial<NewNoteFacts> = {}) => facts(id, { term_norm: term, lemma: term, zipf: 7, ...p });

describe('interference guard: hard groups', () => {
  const kucuk = [
    W('small', 'small', { meanings: ['küçük'] }),
    W('little', 'little', { meanings: ['küçük', 'az'] }),
    W('tiny', 'tiny', { meanings: ['minik', 'küçük'] }),
  ];

  it('introduces one of three words meaning "küçük" a day, even with nothing else left', () => {
    const { notes, postponed } = run(kucuk, 10);
    expect(notes).toHaveLength(1);
    expect(postponed).toHaveLength(2);
    expect(new Set([...notes, ...postponed.map((id) => id.slice(2))])).toEqual(new Set(['small', 'little', 'tiny']));
  });

  it('keeps the daily count when other eligible cards exist', () => {
    const { notes } = run([...kucuk, ...filler(20)], 10);
    expect(notes).toHaveLength(10);
    expect(notes.filter((n) => ['small', 'little', 'tiny'].includes(n))).toHaveLength(1);
  });

  it('holds a reported pair or a false friend apart, even alone', () => {
    const pairs = new Set([pairKey('affect', 'effect')]);
    const { notes, postponed } = run([W('a', 'affect'), W('e', 'effect')], 5, { pairs });
    expect(notes).toHaveLength(1);
    expect(postponed).toHaveLength(1);
  });

  it('holds a contrast card apart from its terms', () => {
    const c = facts('c', { term_type: 'contrast', term_norm: 'affect ↔ effect', contrast: ['affect', 'effect'], manual: true, source_id: null, created_at: DAY_START });
    const { notes } = run([c, W('a', 'affect'), W('e', 'effect')], 5);
    expect(notes).toEqual(['c']);
  });

  it('holds a synonym set apart (shared English gloss)', () => {
    const big = W('big', 'big', { synonyms: ['big', 'large'] });
    const large = W('large', 'large', { synonyms: ['large'] });
    expect(run([big, large], 5).notes).toHaveLength(1);
  });

  it('still takes softly confusable cards when nothing else is left (spelling only)', () => {
    expect(run([W('x', 'desert'), W('y', 'dessert')], 5).notes.sort()).toEqual(['x', 'y']);
  });

  it('counts a card introduced earlier today (another study mode too)', () => {
    const all = [...kucuk, ...filler(3)];
    const { notes, postponed } = run(all.slice(1), 10, { notes: new Map(all.map((f) => [f.note_id, f])), introducedToday: ['small'] });
    expect(notes).not.toContain('little');
    expect(notes).not.toContain('tiny');
    expect(postponed.sort()).toEqual(['c-little', 'c-tiny']);
  });

  it('is deterministic', () => {
    const list = [...kucuk, ...filler(30)];
    expect(run(list, 12)).toEqual(run(list, 12));
  });
});

describe('interference guard: postponed cards come first on a later day', () => {
  it('a postponed card leads the next day, ahead of better-scored cards', () => {
    const list = [W('small', 'small', { meanings: ['küçük'], zipf: 8 }), W('little', 'little', { meanings: ['küçük'], zipf: 6 }), ...filler(20)];
    const day1 = run(list, 5);
    expect(day1.notes[0]).toBe('small');
    expect(day1.notes).not.toContain('little');
    expect(day1.postponed).toEqual(['c-little']);
    // Day 2: frequent new words arrived that would come before "little"; the carry wins.
    const fresh = filler(30)
      .slice(25)
      .map((f) => ({ ...f, zipf: 9 }));
    const rest = [...list.filter((f) => !day1.notes.includes(f.note_id)), ...fresh];
    const day2 = { seed: newOrderSeed('user-a', '2026-11-03'), dayStart: DAY_START + DAY };
    expect(run(rest, 5, day2).notes[0]).not.toBe('little');
    const carried = run(rest, 5, { ...day2, carry: day1.postponed });
    expect(carried.notes[0]).toBe('little');
    expect(carried.postponed).toEqual([]);
  });

  it('a carried card is still never introduced next to a hard group-mate', () => {
    const list = [W('a', 'small', { meanings: ['küçük'] }), W('b', 'little', { meanings: ['küçük'] }), ...filler(5)];
    const { notes, postponed } = run(list, 5, { carry: ['c-a', 'c-b'] });
    expect(notes[0]).toBe('a');
    expect(notes).not.toContain('b');
    expect(postponed).toEqual(['c-b']);
  });

  it('only cards that were next in line are postponed, not every group-mate down the list', () => {
    // Limit 2: "little" (lowest score) is never reached, so it is not carried.
    const list = [W('small', 'small', { meanings: ['küçük'], zipf: 8 }), W('little', 'little', { meanings: ['küçük'], zipf: 2 }), ...filler(10).map((f) => ({ ...f, zipf: 6 }))];
    const { postponed } = run(list, 2);
    expect(postponed).toEqual([]);
  });
});

describe('interference guard: insertion order', () => {
  const mk = (list: NewNoteFacts[]) => list.map((f, i) => cardOf(f, i));

  it('keeps the order, skips a hard group-mate and carries it', () => {
    const list = [W('a', 'small', { meanings: ['küçük'] }), W('b', 'little', { meanings: ['küçük'] }), ...filler(3)];
    const sel = selectAddedCards(mk(list), 3, () => false, input(list));
    expect(sel.cards.map((c) => c.note_id)).toEqual(['a', 'f000', 'f001']);
    expect(sel.postponed).toEqual(['c-b']);
    const next = selectAddedCards(mk(list.slice(1)), 3, () => false, input(list.slice(1), { carry: sel.postponed }));
    expect(next.cards[0]!.note_id).toBe('b');
  });

  it('is what selectNewCards does with order "added"', () => {
    const list = [W('a', 'small', { meanings: ['küçük'] }), W('b', 'little', { meanings: ['küçük'] }), ...filler(3)];
    const a = selectAddedCards(mk(list), 3, () => false, input(list));
    const b = selectNewCards(mk(list), 3, () => false, input(list, { order: 'added' }));
    expect(b.cards).toEqual(a.cards);
    expect(b.postponed).toEqual(a.postponed);
  });
});

describe('interference guard: properties', () => {
  const group = fc.record({ meaning: fc.integer({ min: 0, max: 6 }), syn: fc.integer({ min: 0, max: 6 }), zipf: fc.integer({ min: 2, max: 7 }) });

  it('no two cards of one hard group on a day; a shortfall only when every card left is blocked', () => {
    fc.assert(
      fc.property(
        fc.array(group, { minLength: 1, maxLength: 40 }),
        fc.integer({ min: 1, max: 15 }),
        fc.integer({ min: 0, max: 3 }),
        fc.constantFrom<'smart' | 'added'>('smart', 'added'),
        (spec, limit, introducedN, order) => {
          const list = spec.map((s, i) =>
            facts(`n${String(i).padStart(2, '0')}`, {
              term_norm: short('w', i),
              lemma: short('w', i),
              meanings: [`anlam ${s.meaning}`],
              synonyms: [short('w', i), `syn ${s.syn}`],
              zipf: s.zipf,
            }),
          );
          const introduced = list.slice(0, introducedN).map((f) => f.note_id);
          const fresh = list.slice(introducedN);
          const inp = input(list, { introducedToday: introduced, order });
          const sel = selectNewCards(fresh.map((f, i) => cardOf(f, i)), limit, () => false, inp);
          const keysOf = (id: string) => interferenceKeys(inp.notes.get(id)!, new Map());
          // Cards introduced earlier today may share a group (before the guard); new ones never.
          const seen = new Set<string>(introduced.flatMap(keysOf));
          for (const c of sel.cards) {
            for (const k of keysOf(c.note_id)) {
              expect(seen.has(k)).toBe(false);
              seen.add(k);
            }
          }
          if (sel.cards.length < limit) {
            const picked = new Set(sel.cards.map((c) => c.note_id));
            for (const f of fresh) if (!picked.has(f.note_id)) expect(keysOf(f.note_id).some((k) => seen.has(k))).toBe(true);
          }
          // Postponed cards are new cards of this queue and were not chosen.
          for (const id of sel.postponed) {
            expect(fresh.some((f) => `c-${f.note_id}` === id)).toBe(true);
            expect(sel.cards.some((c) => c.id === id)).toBe(false);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('noteFacts: synonym keys', () => {
  const note = { id: 'n', term: 'Big', term_norm: 'big', term_type: 'word' as const, created_at: 5, level_override: null };
  const lex = { id: 'L1', gloss_en: 'large; of great size (in amount)' } as LexiconSense;

  it('reads the term and the English gloss alternatives', () => {
    const f = noteFacts(note, [{ pos: 'adj', lexicon_sense_id: 'L1', meaning_tr: 'büyük', meaning_tr_override: null, source_id: null }], (id) => (id === 'L1' ? lex : undefined), null);
    expect(f.synonyms).toEqual(['big', 'large', 'of great size']);
  });

  it('normalises a gloss: articles, "to", brackets', () => {
    expect(synonymKey('To Begin')).toBe('begin');
    expect(synonymKey('a large house (old)')).toBe('large house');
  });
});

describe('buildQueue with the guard', () => {
  const ctx = (p: Partial<QueueContext> = {}): QueueContext => ({
    now: NOW,
    dayEnd: DAY_START + DAY,
    dailyNewLimit: 3,
    newIntroducedToday: 0,
    reviewedTodayCardIds: new Set(),
    reviewedTodayNoteIds: new Set(),
    learnAheadMs: 0,
    ...p,
  });
  const list = [W('a', 'small', { meanings: ['küçük'] }), W('b', 'little', { meanings: ['küçük'] }), ...filler(4)];
  const cards = list.map((f, i) => makeCard({ id: `c-${f.note_id}`, note_id: f.note_id, created_at: OLD + i, state: CardState.New, due: OLD }));

  it('insertion order: same count, the guard holds, postponed is returned, no reasons', () => {
    const q = buildQueue(cards, ctx({ newOrder: input(list, { order: 'added' }) }));
    expect(q.counts.new).toBe(3);
    expect(q.items.map((i) => i.note_id)).toEqual(['a', 'f000', 'f001']);
    expect(q.postponed).toEqual(['c-b']);
    expect(q.newReasons).toBeUndefined();
  });

  it('without the order input the old insertion order is unchanged', () => {
    const q = buildQueue(cards, ctx());
    expect(q.items.map((i) => i.note_id)).toEqual(['a', 'b', 'f000']);
    expect(q.postponed).toBeUndefined();
  });
});
