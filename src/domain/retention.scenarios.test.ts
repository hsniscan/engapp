// Acceptance criterion 4 (v0.3): 20 fixed scenarios in which the weakest category is known.
// Each scenario goes through the whole path: review logs → counted answers → groups → weakest.
import { describe, expect, it } from 'vitest';
import { makeLog } from '../test/factories';
import {
  buildProgressReport,
  collectRetention,
  makeDayOf,
  type RetentionCardFacts,
  type RetentionDimension,
} from './retention';
import type { ReviewLog } from './types';

const DAY = 86_400_000;
const MIN = 60_000;
const T0 = Date.UTC(2026, 6, 1, 9); // 1 Jul 2026, 12:00 Istanbul
const NOW = T0 + 80 * DAY;
const CFG = { timezone: 'Europe/Istanbul', day_start_hour: 4 };

interface CardSpec {
  f?: Partial<RetentionCardFacts>;
  ok: number;
  fail: number;
  start?: number;
  /** Every miss is undone and answered Good instead. */
  undoFails?: boolean;
  /** Again answers while learning (before the card first reaches Review). */
  learningAgains?: number;
  /** After each day's Good, the card is answered Again once more the same day. */
  sameDayAgain?: boolean;
  /** The card was deleted: it has logs but no facts. */
  deleted?: boolean;
}

interface Scenario {
  name: string;
  cards: CardSpec[];
  expected: [RetentionDimension, string] | null;
}

function logsOf(id: string, s: CardSpec): ReviewLog[] {
  const start = s.start ?? T0;
  const logs: ReviewLog[] = [];
  let t = start;
  for (let i = 0; i < (s.learningAgains ?? 0); i++)
    logs.push(makeLog({ card_id: id, reviewed_at: (t += MIN), rating: 1 }));
  logs.push(makeLog({ card_id: id, reviewed_at: (t += MIN), rating: 4 }));
  for (let i = 0; i < s.ok + s.fail; i++) {
    const at = start + (i + 1) * DAY;
    if (i < s.fail) {
      const again = makeLog({ card_id: id, reviewed_at: at, rating: 1 });
      logs.push(again);
      if (s.undoFails)
        logs.push(makeLog({ card_id: id, reviewed_at: at + 1000, rating: 3, undo_of: again.id }));
      logs.push(makeLog({ card_id: id, reviewed_at: at + 10 * MIN, rating: 3 }));
    } else {
      logs.push(makeLog({ card_id: id, reviewed_at: at, rating: 3 }));
      if (s.sameDayAgain) {
        logs.push(makeLog({ card_id: id, reviewed_at: at + 60 * MIN, rating: 1 }));
        logs.push(makeLog({ card_id: id, reviewed_at: at + 70 * MIN, rating: 3 }));
      }
    }
  }
  return logs;
}

function weakestOf(sc: Scenario) {
  const logs: ReviewLog[][] = [];
  const facts = new Map<string, RetentionCardFacts>();
  sc.cards.forEach((spec, i) => {
    const id = `card-${i}`;
    logs.push(logsOf(id, spec));
    if (!spec.deleted)
      facts.set(id, {
        note_id: `note-${i}`,
        card_type: 'recognition',
        term_type: 'word',
        level: null,
        topics: [],
        sources: [],
        pos: [],
        ...spec.f,
      });
  });
  const data = collectRetention(logs, makeDayOf(CFG));
  const report = buildProgressReport(data, facts, { now: NOW, today: '2026-09-19' });
  return report.weakest ? [report.weakest.dimension, report.weakest.key] : null;
}

const SCENARIOS: Scenario[] = [
  {
    name: '1. phrases are weaker than words',
    cards: [
      { f: { term_type: 'word' }, ok: 18, fail: 2 },
      { f: { term_type: 'phrase' }, ok: 14, fail: 6 },
    ],
    expected: ['term_type', 'phrase'],
  },
  {
    name: '2. a group with 19 answers is "veri az" and never the weakest',
    cards: [
      { f: { term_type: 'word' }, ok: 40, fail: 10 },
      { f: { term_type: 'pattern' }, ok: 17, fail: 3 },
      { f: { term_type: 'phrase', card_type: 'cloze' }, ok: 3, fail: 16 },
    ],
    expected: ['term_type', 'word'],
  },
  {
    name: '3. exactly 20 answers is enough',
    cards: [
      { f: { term_type: 'phrase' }, ok: 10, fail: 10 },
      { f: { term_type: 'word' }, ok: 30, fail: 0 },
    ],
    expected: ['term_type', 'phrase'],
  },
  {
    name: '4. the weakest level',
    cards: [
      { f: { level: 'B2' }, ok: 12, fail: 8 },
      { f: { level: 'B1' }, ok: 25, fail: 5 },
      { f: { level: 'A2' }, ok: 20, fail: 0 },
    ],
    expected: ['level', 'B2'],
  },
  {
    name: '5. words without a level are left out',
    cards: [
      { f: { level: null }, ok: 17, fail: 8 },
      { f: { level: 'B1' }, ok: 18, fail: 2 },
      { f: { level: 'C1' }, ok: 15, fail: 5 },
    ],
    expected: ['level', 'C1'],
  },
  {
    name: '6. a card from two topics counts for both',
    cards: [
      { f: { topics: ['travel', 'food'] }, ok: 10, fail: 10 },
      { f: { topics: ['food'] }, ok: 20, fail: 0 },
      { f: { topics: ['travel'] }, ok: 15, fail: 5 },
    ],
    expected: ['topic', 'travel'],
  },
  {
    name: '7. no group has 20 answers',
    cards: [
      { f: { term_type: 'word' }, ok: 5, fail: 5 },
      { f: { term_type: 'phrase' }, ok: 3, fail: 4 },
    ],
    expected: null,
  },
  {
    name: '8. undone misses do not count',
    cards: [
      { f: { term_type: 'phrase' }, ok: 14, fail: 6, undoFails: true },
      { f: { term_type: 'word' }, ok: 18, fail: 2 },
    ],
    expected: ['term_type', 'word'],
  },
  {
    name: '9. answers older than 90 days do not count',
    cards: [
      { f: { term_type: 'phrase' }, ok: 0, fail: 30, start: T0 - 120 * DAY },
      { f: { term_type: 'word' }, ok: 14, fail: 6 },
      { f: { term_type: 'pattern' }, ok: 19, fail: 1 },
    ],
    expected: ['term_type', 'word'],
  },
  {
    name: '10. the weakest source',
    cards: [
      { f: { sources: ['s1'] }, ok: 15, fail: 5 },
      { f: { sources: ['s2'] }, ok: 19, fail: 1 },
      { f: { sources: [] }, ok: 18, fail: 1 },
    ],
    expected: ['source', 's1'],
  },
  {
    name: '11. the weakest part of speech',
    cards: [
      { f: { pos: ['noun'] }, ok: 18, fail: 2 },
      { f: { pos: ['verb'] }, ok: 13, fail: 7 },
      { f: { pos: ['adjective'] }, ok: 20, fail: 0 },
    ],
    expected: ['pos', 'verb'],
  },
  {
    name: '12. production is weaker than recognition',
    cards: [
      { f: { card_type: 'recognition' }, ok: 19, fail: 1 },
      { f: { card_type: 'production' }, ok: 12, fail: 8 },
    ],
    expected: ['card_type', 'production'],
  },
  {
    name: '13. same rate and count in two dimensions: term type comes first',
    cards: [
      { f: { term_type: 'phrase' }, ok: 15, fail: 5 },
      { f: { term_type: 'word', level: 'B2' }, ok: 15, fail: 5 },
      { f: { term_type: 'word', level: 'A1' }, ok: 20, fail: 0 },
    ],
    expected: ['term_type', 'phrase'],
  },
  {
    name: '14. same rate and count in one dimension: alphabetical key',
    cards: [
      { f: { topics: ['travel'] }, ok: 15, fail: 5 },
      { f: { topics: ['food'] }, ok: 15, fail: 5 },
      { f: { topics: ['science'] }, ok: 20, fail: 0 },
    ],
    expected: ['topic', 'food'],
  },
  {
    name: '15. same rate (1/3), more answers first',
    cards: [
      { f: { term_type: 'phrase' }, ok: 7, fail: 14 },
      { f: { term_type: 'pattern' }, ok: 14, fail: 28 },
      { f: { term_type: 'word' }, ok: 40, fail: 0 },
    ],
    expected: ['term_type', 'pattern'],
  },
  {
    name: '16. misses while learning do not count',
    cards: [
      { f: { term_type: 'phrase' }, ok: 18, fail: 2, learningAgains: 10 },
      { f: { term_type: 'word' }, ok: 15, fail: 5 },
    ],
    expected: ['term_type', 'word'],
  },
  {
    name: '17. only the first answer of a day counts',
    cards: [
      { f: { term_type: 'word' }, ok: 20, fail: 0, sameDayAgain: true },
      { f: { term_type: 'phrase' }, ok: 16, fail: 4 },
    ],
    expected: ['term_type', 'phrase'],
  },
  {
    name: '18. deleted cards do not count',
    cards: [
      { f: { term_type: 'phrase' }, ok: 0, fail: 30, deleted: true },
      { f: { term_type: 'word' }, ok: 16, fail: 4 },
      { f: { term_type: 'pattern' }, ok: 19, fail: 1 },
    ],
    expected: ['term_type', 'word'],
  },
  {
    name: '19. roots and affixes',
    cards: [
      { f: { term_type: 'affix' }, ok: 10, fail: 10 },
      { f: { term_type: 'word' }, ok: 30, fail: 0 },
      { f: { term_type: 'word', card_type: 'production' }, ok: 20, fail: 5 },
    ],
    expected: ['term_type', 'affix'],
  },
  {
    name: '20. a realistic mix',
    cards: [
      {
        f: { term_type: 'word', level: 'B1', topics: ['travel'], sources: ['s1'], pos: ['noun'] },
        ok: 30,
        fail: 3,
      },
      {
        f: {
          term_type: 'word',
          level: 'B1',
          topics: ['travel'],
          sources: ['s1'],
          pos: ['noun'],
          card_type: 'production',
        },
        ok: 24,
        fail: 2,
      },
      {
        f: {
          term_type: 'phrase',
          level: 'B2',
          topics: ['business'],
          sources: ['s2'],
          pos: ['phrasal verb'],
        },
        ok: 22,
        fail: 6,
      },
      {
        f: {
          term_type: 'phrase',
          level: 'B2',
          topics: ['business'],
          sources: ['s2'],
          pos: ['phrasal verb'],
          card_type: 'production',
        },
        ok: 12,
        fail: 10,
      },
      { f: { term_type: 'pattern', level: 'C1' }, ok: 20, fail: 2 },
      {
        f: { term_type: 'phrase', level: 'B1', topics: ['travel'], sources: ['s1'], pos: ['noun'] },
        ok: 20,
        fail: 0,
      },
    ],
    expected: ['level', 'B2'],
  },
];

describe('weakest group: 20 fixed scenarios', () => {
  it('has 20 scenarios', () => expect(SCENARIOS).toHaveLength(20));
  for (const sc of SCENARIOS) {
    it(sc.name, () => {
      expect(weakestOf(sc)).toEqual(sc.expected);
    });
  }
});
