import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { makeCard } from '../test/factories';
import { pairKey } from './confusables';
import { parseClientLevels } from './level';
import {
  bandOf,
  confusable,
  type NewNoteFacts,
  type NewOrderInput,
  newOrderSeed,
  noteFacts,
  selectNewCards,
} from './newOrder';
import { buildQueue, type QueueContext } from './queue';
import { type Card, type CefrLevel, CardState } from './types';

const DAY = 86_400_000;
const DAY_START = Date.UTC(2026, 9, 22, 1);
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

function input(list: NewNoteFacts[], p: Partial<NewOrderInput> = {}): NewOrderInput {
  return {
    level: 'B1',
    seed: newOrderSeed('user-a', '2026-10-22'),
    dayStart: DAY_START,
    notes: new Map(list.map((f) => [f.note_id, f])),
    activeSources: new Set(),
    pairs: new Set(),
    introducedToday: [],
    ...p,
  };
}

const cardOf = (f: NewNoteFacts): Card => makeCard({ id: `c-${f.note_id}`, note_id: f.note_id, created_at: f.created_at });
const select = (list: NewNoteFacts[], limit: number, p: Partial<NewOrderInput> = {}) =>
  selectNewCards(list.map(cardOf), limit, () => false, input(list, p)).cards.map((c) => c.note_id);

const LEVELS: CefrLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

/** A 4-letter term: too short for the spelling and derivation rules, so never confusable. */
const short = (prefix: string, i: number) => `${prefix}${i.toString(36).padStart(3, '0')}`;

/** A pool of distinct, mutually unconfusable words with the given levels. */
function pool(levels: CefrLevel[]): NewNoteFacts[] {
  return levels.map((cefr, i) => facts(`n${String(i).padStart(4, '0')}`, { cefr, term_norm: short('w', i), lemma: short('w', i) }));
}

describe('bandOf', () => {
  it('places notes against the learner level; unknown counts as X+1', () => {
    expect(bandOf(facts('a', { cefr: 'B1' }), 'B1', false, DAY_START)).toBe('same');
    expect(bandOf(facts('a', { cefr: 'A1' }), 'B1', false, DAY_START)).toBe('lower');
    expect(bandOf(facts('a', { cefr: 'B2' }), 'B1', false, DAY_START)).toBe('next');
    expect(bandOf(facts('a', { cefr: null }), 'B1', false, DAY_START)).toBe('next');
    expect(bandOf(facts('a', { cefr: 'C2' }), 'B1', false, DAY_START)).toBe('above');
  });

  it('puts recent hand-added notes first and never holds the user’s own choices above X+1', () => {
    expect(bandOf(facts('a', { cefr: 'C2', manual: true, created_at: DAY_START - DAY }), 'B1', false, DAY_START)).toBe('priority');
    expect(bandOf(facts('a', { cefr: 'C2', manual: true, created_at: DAY_START - 30 * DAY }), 'B1', false, DAY_START)).toBe('next');
    expect(bandOf(facts('a', { cefr: 'C2' }), 'B1', true, DAY_START)).toBe('next');
  });
});

describe('selectNewCards: level mix', () => {
  it('takes about 60 % at the level, 30 % below and at most 10 % one level up', () => {
    const list = pool([...Array(30).fill('B1'), ...Array(30).fill('A2'), ...Array(30).fill('B2'), ...Array(30).fill('C2')]);
    const chosen = select(list, 10);
    const lv = chosen.map((id) => list.find((f) => f.note_id === id)!.cefr);
    expect(lv.filter((l) => l === 'B1')).toHaveLength(6);
    expect(lv.filter((l) => l === 'A2')).toHaveLength(3);
    expect(lv.filter((l) => l === 'B2')).toHaveLength(1);
    expect(lv).not.toContain('C2');
  });

  it('property: never above X+1 and X+1 within 10 % while the pool allows', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom<CefrLevel>(...LEVELS), { minLength: 1, maxLength: 120 }),
        fc.constantFrom<CefrLevel>(...LEVELS),
        fc.integer({ min: 1, max: 40 }),
        fc.string(),
        (levels, level, limit, user) => {
          const list = pool(levels);
          const chosen = select(list, limit, { level, seed: newOrderSeed(user, '2026-10-22') });
          const rank = (l: CefrLevel) => LEVELS.indexOf(l) - LEVELS.indexOf(level);
          const atOrBelow = levels.filter((l) => rank(l) <= 0).length;
          const upToNext = levels.filter((l) => rank(l) <= 1).length;
          const got = chosen.map((id) => rank(list.find((f) => f.note_id === id)!.cefr!));
          expect(chosen).toHaveLength(Math.min(limit, levels.length));
          if (upToNext >= Math.min(limit, levels.length)) expect(got.every((d) => d <= 1)).toBe(true);
          if (atOrBelow >= limit) expect(got.filter((d) => d === 1).length).toBeLessThanOrEqual(Math.floor(limit / 10));
          if (levels.filter((l) => rank(l) === 0).length >= limit && levels.filter((l) => rank(l) < 0).length >= limit)
            expect(got.filter((d) => d === 0).length).toBeGreaterThanOrEqual(Math.floor(limit * 0.55));
        },
      ),
      { numRuns: 150 },
    );
  });

  it('prefers the closest lower level and frequent words', () => {
    const list = [
      facts('a1', { cefr: 'A1', zipf: 6, term_norm: 'aaaa', lemma: 'aaaa' }),
      facts('a2', { cefr: 'A2', zipf: 6, term_norm: 'bbbb', lemma: 'bbbb' }),
      facts('b1-rare', { zipf: 2, term_norm: 'cccc', lemma: 'cccc' }),
      facts('b1-common', { zipf: 6.5, term_norm: 'dddd', lemma: 'dddd' }),
    ];
    const order = select(list, 4);
    expect(order[0]).toBe('b1-common');
    expect(order.indexOf('a2')).toBeLessThan(order.indexOf('a1'));
  });
});

describe('selectNewCards: the user’s signals', () => {
  it('property: recent hand-added cards come first, oldest first, whatever their level', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5 }), fc.integer({ min: 1, max: 20 }), fc.string(), (manual, limit, user) => {
        const list = [
          ...pool(Array(20).fill('B1')),
          ...Array.from({ length: manual }, (_, i) =>
            facts(`m${i}`, { manual: true, source_id: null, cefr: 'C2', created_at: DAY_START - i * 3600_000, term_norm: short('m', i), lemma: short('m', i) }),
          ),
        ];
        const chosen = select(list, limit, { seed: newOrderSeed(user, 'd') });
        const expected = Array.from({ length: manual }, (_, i) => `m${manual - 1 - i}`).slice(0, limit);
        expect(chosen.slice(0, expected.length)).toEqual(expected);
      }),
    );
  });

  it('does not starve an active source: its cards lead their band', () => {
    const list = [
      ...pool(Array(40).fill('B1')),
      ...Array.from({ length: 5 }, (_, i) => facts(`s${i}`, { source_id: 'active', zipf: 2, term_norm: short('s', i), lemma: short('s', i) })),
    ];
    const chosen = select(list, 10, { activeSources: new Set(['active']) });
    expect(chosen.filter((id) => id.startsWith('s'))).toHaveLength(5);
  });

  it('lets an active source’s hard words trickle in instead of never', () => {
    const list = [
      ...pool(Array(40).fill('B1')),
      ...Array.from({ length: 5 }, (_, i) => facts(`h${i}`, { source_id: 'active', cefr: 'C2', term_norm: short('h', i), lemma: short('h', i) })),
    ];
    expect(select(list, 10, { activeSources: new Set(['active']) }).filter((id) => id.startsWith('h'))).toHaveLength(1);
    expect(select(list, 10).filter((id) => id.startsWith('h'))).toHaveLength(0);
  });
});

describe('selectNewCards: per-user daily variation', () => {
  const list = pool(Array(60).fill('B1')).map((f, i) => ({ ...f, zipf: 4 + (i % 3) * 0.01 }));

  it('is deterministic for one user and day', () => {
    expect(select(list, 20)).toEqual(select(list, 20));
  });

  it('differs between users and between days', () => {
    const a = select(list, 20, { seed: newOrderSeed('user-a', '2026-10-22') });
    const b = select(list, 20, { seed: newOrderSeed('user-b', '2026-10-22') });
    const c = select(list, 20, { seed: newOrderSeed('user-a', '2026-10-23') });
    expect(a).not.toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('property: two random users almost never get the same order of 10 out of 60 equal cards', () => {
    let same = 0;
    fc.assert(
      fc.property(fc.uuid(), fc.uuid(), (u1, u2) => {
        fc.pre(u1 !== u2);
        const a = select(list, 10, { seed: newOrderSeed(u1, 'd') });
        const b = select(list, 10, { seed: newOrderSeed(u2, 'd') });
        if (a.join() === b.join()) same++;
      }),
      { numRuns: 100 },
    );
    expect(same).toBeLessThanOrEqual(1);
  });

  it('property: stable within a day — introducing cards continues the same sequence', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.constantFrom<CefrLevel>('A1', 'A2', 'B1', 'B2', 'C1'), fc.integer({ min: 0, max: 12 }), fc.boolean()), {
          minLength: 1,
          maxLength: 60,
        }),
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 0, max: 20 }),
        fc.string(),
        (spec, limit, done, user) => {
          // Small meaning alphabet: plenty of confusable pairs.
          const list = spec.map(([cefr, m, manual], i) =>
            facts(`n${String(i).padStart(3, '0')}`, {
              cefr,
              meanings: [`anlam ${m}`],
              manual,
              source_id: manual ? null : 'src',
              created_at: manual ? DAY_START - (i % 9) * DAY : OLD,
              term_norm: short('w', i),
              lemma: short('w', i),
            }),
          );
          const p = { seed: newOrderSeed(user, '2026-10-22') };
          const full = select(list, limit, p);
          const k = Math.min(done, full.length);
          const introduced = full.slice(0, k);
          const rest = list.filter((f) => !introduced.includes(f.note_id));
          const again = select(rest, limit - k, { ...p, notes: new Map(list.map((f) => [f.note_id, f])), introducedToday: introduced });
          expect(again).toEqual(full.slice(k));
        },
      ),
      { numRuns: 150 },
    );
  });
});

describe('selectNewCards: interference', () => {
  const B1 = (id: string, term: string, p: Partial<NewNoteFacts> = {}) => facts(id, { term_norm: term, lemma: term, ...p });
  const filler = () => pool(Array(20).fill('B1')).map((f) => ({ ...f, zipf: 3 }));

  it.each([
    ['same family', B1('x', 'employ', { family: 7, zipf: 7 }), B1('y', 'workforce', { family: 7, zipf: 7 })],
    ['derivation', B1('x', 'employ', { zipf: 7 }), B1('y', 'employment', { zipf: 7 })],
    ['same lemma', B1('x', 'running', { lemma: 'run', zipf: 7 }), B1('y', 'runs', { lemma: 'run', zipf: 7 })],
    ['shared Turkish meaning', B1('x', 'affect', { meanings: ['etkilemek'], zipf: 7 }), B1('y', 'influence', { meanings: ['etki', 'etkilemek'], zipf: 7 })],
    ['near spelling', B1('x', 'desert', { zipf: 7 }), B1('y', 'dessert', { zipf: 7 })],
  ])('keeps a %s pair apart when alternatives exist', (_, x, y) => {
    const chosen = select([x, y, ...filler()], 10);
    expect(chosen).toContain('x');
    expect(chosen).not.toContain('y');
  });

  it('keeps a reported pair and a contrast card apart from their terms', () => {
    const x = B1('x', 'borrow', { zipf: 7 });
    const y = B1('y', 'lend', { zipf: 7 });
    const chosen = select([x, y, ...filler()], 10, { pairs: new Set([pairKey('borrow', 'lend')]) });
    expect(chosen).toContain('x');
    expect(chosen).not.toContain('y');
    const c = facts('c', { term_type: 'contrast', term_norm: 'borrow ↔ lend', contrast: ['borrow', 'lend'], manual: true, source_id: null, created_at: DAY_START });
    const withCard = select([c, x, ...filler()], 10);
    expect(withCard[0]).toBe('c');
    expect(withCard).not.toContain('x');
  });

  it('also avoids a pair with a card introduced earlier today', () => {
    const x = B1('x', 'desert', { zipf: 7 });
    const y = B1('y', 'dessert', { zipf: 7 });
    const all = [x, y, ...filler()];
    const chosen = select([y, ...filler()], 5, { notes: new Map(all.map((f) => [f.note_id, f])), introducedToday: ['x'] });
    expect(chosen).not.toContain('y');
  });

  it('takes confusable cards after all when nothing else is left (the limit is filled)', () => {
    const chosen = select([B1('x', 'desert'), B1('y', 'dessert')], 10);
    expect(chosen.sort()).toEqual(['x', 'y']);
  });

  it('property: no confusable pair on one day while unconfusable cards are left', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 30 }), { minLength: 2, maxLength: 80 }), fc.integer({ min: 1, max: 15 }), (ms, limit) => {
        const list = ms.map((m, i) => facts(`n${i}`, { meanings: [`anlam ${m}`], term_norm: short('w', i), lemma: short('w', i) }));
        const chosen = select(list, limit).map((id) => list.find((f) => f.note_id === id)!);
        const distinct = new Set(ms).size;
        if (distinct >= limit) {
          for (let i = 0; i < chosen.length; i++)
            for (let j = i + 1; j < chosen.length; j++) expect(confusable(chosen[i]!, chosen[j]!, new Set())).toBe(false);
        }
      }),
    );
  });
});

describe('noteFacts', () => {
  const data = parseClientLevels('dessert\t3.9\tn:A2:j\nbank\t5.1\tn:A1:j\n');
  const note = { id: 'n', term: 'dessert', term_norm: 'dessert', term_type: 'word' as const, created_at: 5, level_override: null };

  it('reads level, frequency, meanings, source and family', () => {
    const f = noteFacts(note, [{ pos: 'noun', lexicon_sense_id: null, meaning_tr: 'tatlı, (yemek sonrası) tatlı', meaning_tr_override: null, source_id: 'src-1' }], () => undefined, data, (l) => (l === 'dessert' ? 3 : null));
    expect(f).toMatchObject({ cefr: 'A2', zipf: 3.9, manual: false, source_id: 'src-1', family: 3, lemma: 'dessert' });
    expect(f.meanings).toEqual(['tatlı', '(yemek sonrası) tatlı']);
  });

  it('marks a note without sources as hand-added and reads a contrast card’s terms', () => {
    expect(noteFacts(note, [{ pos: null, lexicon_sense_id: null, meaning_tr: 'tatlı', meaning_tr_override: null, source_id: null }], () => undefined, null).manual).toBe(true);
    const c = noteFacts({ ...note, term: 'Affect ↔ effect', term_norm: 'affect ↔ effect', term_type: 'contrast' }, [], () => undefined, null);
    expect(c.contrast).toEqual(['affect', 'effect']);
  });
});

// ------------------------------------------------------------------ queue invariants

describe('buildQueue with the smart order', () => {
  const ctx = (p: Partial<QueueContext> = {}): QueueContext => ({
    now: NOW,
    dayEnd: DAY_START + DAY,
    dailyNewLimit: 10,
    newIntroducedToday: 0,
    reviewedTodayCardIds: new Set(),
    reviewedTodayNoteIds: new Set(),
    learnAheadMs: 0,
    ...p,
  });

  it('property: same limit, 1 card per note, 5:1 rhythm, burying and locks as insertion order', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            note: fc.integer({ min: 0, max: 25 }),
            kind: fc.constantFrom('new', 'new', 'review', 'learning'),
            type: fc.constantFrom('recognition', 'production', 'cloze'),
            unlocked: fc.boolean(),
            suspended: fc.boolean(),
            level: fc.constantFrom<CefrLevel>(...LEVELS),
          }),
          { maxLength: 80 },
        ),
        fc.integer({ min: 0, max: 15 }),
        fc.integer({ min: 0, max: 5 }),
        fc.integer({ min: 0, max: 5 }),
        fc.array(fc.integer({ min: 0, max: 25 }), { maxLength: 4 }),
        (spec, limit, extra, introduced, buriedNotes) => {
          const cards = spec.map((s, i) =>
            makeCard({
              id: `c${String(i).padStart(3, '0')}`,
              note_id: `n${s.note}`,
              card_type: s.type,
              created_at: OLD + i,
              unlocked: s.unlocked || s.type === 'recognition',
              suspended: s.suspended && i % 3 === 0,
              state: s.kind === 'new' ? CardState.New : s.kind === 'review' ? CardState.Review : CardState.Learning,
              due: s.kind === 'new' ? OLD : NOW - 1000,
            }),
          );
          const notes = new Map(spec.map((s) => [`n${s.note}`, facts(`n${s.note}`, { cefr: s.level, term_norm: short('t', s.note), lemma: short('t', s.note) })]));
          const base = ctx({
            dailyNewLimit: limit,
            extraNewToday: extra,
            newIntroducedToday: introduced,
            reviewedTodayNoteIds: new Set(buriedNotes.map((n) => `n${n}`)),
          });
          const plain = buildQueue(cards, base);
          const smart = buildQueue(cards, { ...base, newOrder: input([...notes.values()]) });
          expect(smart.counts).toEqual(plain.counts);
          expect(smart.items.map((i) => i.kind)).toEqual(plain.items.map((i) => i.kind));
          const newOnes = smart.items.filter((i) => i.kind === 'new');
          expect(new Set(smart.items.map((i) => i.note_id)).size).toBe(smart.items.length);
          for (const it of newOnes) {
            const c = cards.find((x) => x.id === it.card_id)!;
            expect(c.unlocked && !c.suspended && c.deleted_at === null).toBe(true);
            expect(base.reviewedTodayNoteIds.has(c.note_id)).toBe(false);
          }
          expect(smart.newReasons?.size).toBe(newOnes.length);
        },
      ),
      { numRuns: 150 },
    );
  });

  it('adds no new cards in ahead mode', () => {
    const cards = [makeCard({ note_id: 'a', created_at: OLD })];
    expect(buildQueue(cards, ctx({ mode: 'ahead', newOrder: input([facts('a')]) })).counts.new).toBe(0);
  });
});

// ------------------------------------------------------------------ speed

describe('selectNewCards: speed', () => {
  it('chooses from 10,000 new cards in well under the session budget', () => {
    const list = Array.from({ length: 10_000 }, (_, i) =>
      facts(`n${String(i).padStart(5, '0')}`, {
        cefr: LEVELS[i % 6]!,
        zipf: 2 + (i % 50) / 10,
        meanings: [`anlam ${i % 3000}`],
        term_norm: `word${i}`,
        lemma: `word${i}`,
        source_id: i % 4 === 0 ? 'active' : 'src',
      }),
    );
    const cards = list.map(cardOf);
    const inp = input(list, { activeSources: new Set(['active']) });
    const t0 = performance.now();
    const sel = selectNewCards(cards, 50, () => false, inp);
    const ms = performance.now() - t0;
    console.info(`[perf] selectNewCards 10k → 50: ${ms.toFixed(1)} ms`);
    expect(sel.cards).toHaveLength(50);
    // Loose guards (CI and parallel test files share the CPU); typical: ~20 ms and ~100 ms.
    expect(ms).toBeLessThan(400);
    const t1 = performance.now();
    selectNewCards(cards, 999, () => false, inp);
    const big = performance.now() - t1;
    console.info(`[perf] selectNewCards 10k → 999: ${big.toFixed(1)} ms`);
    expect(big).toBeLessThan(1500);
  });
});
