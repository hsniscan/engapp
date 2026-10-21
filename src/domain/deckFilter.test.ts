import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  criteriaCount,
  DECK_FILTER_VERSION,
  DECK_STATES,
  type DeckCard,
  deckNoteIds,
  type DeckNoteFacts,
  isStruggling,
  matchesDeck,
  normalizeDeckFilter,
  noteStatus,
  orderDecks,
  parseDeckFilter,
  unsupportedKeys,
} from './deckFilter';
import { CardState } from './types';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 21, 9);

function card(p: Partial<DeckCard> = {}): DeckCard {
  return {
    id: p.id ?? 'c',
    card_type: 'recognition',
    state: CardState.Review,
    suspended: false,
    deleted_at: null,
    lapses: 0,
    difficulty: 4,
    reps: 3,
    ...p,
  };
}

function facts(p: Partial<DeckNoteFacts> & { id?: string; tags?: string[]; created_at?: number } = {}): DeckNoteFacts {
  return {
    note: { id: p.id ?? 'n1', tags: p.tags ?? [], created_at: p.created_at ?? NOW - 60 * DAY },
    cards: p.cards ?? [card()],
    lastAgainAt: p.lastAgainAt ?? null,
    lastPracticeMissAt: p.lastPracticeMissAt ?? null,
  };
}

const ctx = { now: NOW };

describe('deck filter schema', () => {
  it('parses version 1 and normalizes it', () => {
    const r = parseDeckFilter({ v: 1, states: ['suspended', 'new', 'new'], tags: ['İş', 'iş', ' seyahat '], tagMode: 'all' });
    expect(r).toEqual({
      ok: true,
      filter: { v: 1, states: ['new', 'suspended'], tags: ['İş', 'seyahat'], tagMode: 'all' },
    });
  });

  it('drops empty criteria and tagMode with fewer than two tags', () => {
    expect(normalizeDeckFilter({ states: [], tags: ['a'], tagMode: 'all', levels: [], topics: [] })).toEqual({ v: 1, tags: ['a'] });
    expect(criteriaCount(normalizeDeckFilter({}))).toBe(0);
  });

  it('reserves level (İP2) and topic (İP7) keys in version 1', () => {
    const r = parseDeckFilter({ v: 1, levels: ['C1', 'B2'], topics: ['technology'] });
    expect(r).toEqual({ ok: true, filter: { v: 1, levels: ['B2', 'C1'], topics: ['technology'] } });
  });

  it('treats a higher version or an unknown key as made by a newer app', () => {
    expect(parseDeckFilter({ v: 2, tags: ['x'] })).toEqual({ ok: false, reason: 'newer' });
    expect(parseDeckFilter({ v: 1, mood: 'happy' })).toEqual({ ok: false, reason: 'newer' });
  });

  it('rejects garbage without throwing', () => {
    for (const bad of [null, 3, 'x', [], { v: 1, states: ['sleeping'] }, { v: 1, addedWithinDays: -2 }, { states: [] }])
      expect(parseDeckFilter(bad)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('normalize is idempotent and its output always parses (property)', () => {
    const tag = fc.string({ minLength: 0, maxLength: 12 });
    fc.assert(
      fc.property(
        fc.record(
          {
            states: fc.array(fc.constantFrom(...DECK_STATES), { maxLength: 8 }),
            tags: fc.array(tag, { maxLength: 30 }),
            tagMode: fc.constantFrom('any' as const, 'all' as const),
            levels: fc.array(fc.constantFrom('A1' as const, 'B2' as const, 'C2' as const), { maxLength: 5 }),
            addedWithinDays: fc.integer({ min: -5, max: 5000 }),
          },
          { requiredKeys: [] },
        ),
        (input) => {
          const once = normalizeDeckFilter(input);
          expect(normalizeDeckFilter(once)).toEqual(once);
          const parsed = parseDeckFilter(JSON.parse(JSON.stringify(once)));
          expect(parsed).toEqual({ ok: true, filter: once });
        },
      ),
    );
  });
});

describe('note status', () => {
  it('follows the recognition card; suspended when every live card is', () => {
    expect(noteStatus(facts({ cards: [card({ state: CardState.New, reps: 0 })] }))).toBe('new');
    expect(noteStatus(facts({ cards: [card({ state: CardState.Learning })] }))).toBe('learning');
    expect(noteStatus(facts({ cards: [card({ state: CardState.Relearning })] }))).toBe('learning');
    expect(noteStatus(facts({ cards: [card()] }))).toBe('learned');
    expect(noteStatus(facts({ cards: [card({ suspended: true }), card({ id: 'p', card_type: 'production', suspended: true })] }))).toBe('suspended');
    // A suspended recognition card: the status comes from a live one.
    expect(
      noteStatus(facts({ cards: [card({ suspended: true }), card({ id: 'p', card_type: 'production', state: CardState.Learning })] })),
    ).toBe('learning');
    expect(noteStatus(facts({ cards: [] }))).toBeNull();
  });

  it('"struggling" is the practice rule at note level', () => {
    expect(isStruggling(facts({ cards: [card({ lapses: 2 })] }), NOW)).toBe(true);
    expect(isStruggling(facts({ cards: [card({ difficulty: 7.2 })] }), NOW)).toBe(true);
    expect(isStruggling(facts({ lastAgainAt: NOW - 3 * DAY }), NOW)).toBe(true);
    expect(isStruggling(facts({ lastPracticeMissAt: NOW - 13 * DAY }), NOW)).toBe(true);
    expect(isStruggling(facts({ lastAgainAt: NOW - 15 * DAY }), NOW)).toBe(false);
    expect(isStruggling(facts(), NOW)).toBe(false);
    // Never studied or suspended cards do not count.
    expect(isStruggling(facts({ cards: [card({ state: CardState.New, reps: 0 })], lastAgainAt: NOW }), NOW)).toBe(false);
    expect(isStruggling(facts({ cards: [card({ suspended: true, lapses: 5 })] }), NOW)).toBe(false);
  });
});

describe('matchesDeck', () => {
  const f = (raw: object) => normalizeDeckFilter(raw);

  it('an empty filter matches every note', () => {
    expect(matchesDeck(f({}), facts(), ctx)).toBe(true);
  });

  it('states are OR-ed, struggling overlays the main status', () => {
    const deck = f({ states: ['new', 'struggling'] });
    expect(matchesDeck(deck, facts({ cards: [card({ state: CardState.New, reps: 0 })] }), ctx)).toBe(true);
    expect(matchesDeck(deck, facts({ cards: [card({ lapses: 3 })] }), ctx)).toBe(true);
    expect(matchesDeck(deck, facts(), ctx)).toBe(false);
    // A fully suspended note is only "Askıda", never struggling.
    expect(matchesDeck(deck, facts({ cards: [card({ suspended: true, lapses: 3 })] }), ctx)).toBe(false);
    expect(matchesDeck(f({ states: ['suspended'] }), facts({ cards: [card({ suspended: true })] }), ctx)).toBe(true);
  });

  it('tags: any by default, all on request, case-insensitive (Turkish)', () => {
    const n = facts({ tags: ['İş', 'seyahat'] });
    expect(matchesDeck(f({ tags: ['iş', 'yemek'] }), n, ctx)).toBe(true);
    expect(matchesDeck(f({ tags: ['iş', 'yemek'], tagMode: 'all' }), n, ctx)).toBe(false);
    expect(matchesDeck(f({ tags: ['iş', 'SEYAHAT'], tagMode: 'all' }), n, ctx)).toBe(true);
    expect(matchesDeck(f({ tags: ['spor'] }), n, ctx)).toBe(false);
  });

  it('different criteria are AND-ed', () => {
    const deck = f({ tags: ['iş'], states: ['struggling'], addedWithinDays: 7 });
    const fresh = NOW - 2 * DAY;
    expect(matchesDeck(deck, facts({ tags: ['iş'], cards: [card({ lapses: 2 })], created_at: fresh }), ctx)).toBe(true);
    expect(matchesDeck(deck, facts({ tags: ['iş'], cards: [card({ lapses: 2 })], created_at: NOW - 8 * DAY }), ctx)).toBe(false);
    expect(matchesDeck(deck, facts({ tags: ['iş'], created_at: fresh }), ctx)).toBe(false);
    expect(matchesDeck(deck, facts({ cards: [card({ lapses: 2 })], created_at: fresh }), ctx)).toBe(false);
  });

  it('level and topic need their resolvers; without one the deck is not evaluated', () => {
    const deck = { v: DECK_FILTER_VERSION, levels: ['B2'] as const, topics: ['travel'] };
    expect(unsupportedKeys(normalizeDeckFilter({ ...deck, levels: [...deck.levels] }), {})).toEqual(['levels', 'topics']);
    const notes = [facts({ id: 'a' }), facts({ id: 'b' })];
    expect(deckNoteIds(deck, notes, ctx)).toBeNull();
    const withResolvers = {
      now: NOW,
      levelOf: (id: string) => (id === 'a' ? ('B2' as const) : ('A1' as const)),
      topicsOf: (id: string) => (id === 'a' ? ['travel'] : []),
    };
    expect(deckNoteIds(deck, notes, withResolvers)).toEqual(new Set(['a']));
  });

  it('a deck from a newer app version is never evaluated', () => {
    expect(deckNoteIds({ v: 2 }, [facts()], ctx)).toBeNull();
    expect(deckNoteIds({ v: 1, tags: ['x'] }, [facts({ tags: ['x'] })], ctx)).toEqual(new Set(['n1']));
  });
});

describe('orderDecks', () => {
  it('drops deleted decks and sorts by sort, then creation', () => {
    const d = (id: string, sort: number, created_at: number, deleted_at: number | null = null) => ({ id, sort, created_at, deleted_at });
    expect(orderDecks([d('c', 2, 1), d('a', 1, 5), d('b', 1, 2), d('x', 0, 0, 9)]).map((x) => x.id)).toEqual(['b', 'a', 'c']);
  });
});
