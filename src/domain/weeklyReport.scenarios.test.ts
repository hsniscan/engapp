// Acceptance criterion 4 (v0.3), the weekly report's side: in 20 fixed scenarios the report
// names the right weakest category. Each scenario goes through the whole path: review logs →
// counted answers (retention.ts) → the report's week window (with the 28-day fallback) →
// buildWeeklySummary. The AI is not involved: it only ever gets these numbers (see
// supabase/functions/_shared/report.test.ts for "the AI writes only the comment").
import { describe, expect, it } from 'vitest';
import { makeLog } from '../test/factories';
import {
  collectRetention,
  makeDayOf,
  type RetentionCardFacts,
  type RetentionDimension,
} from './retention';
import type { ReviewLog } from './types';
import { buildWeeklySummary } from './weeklyReport';

const DAY = 86_400_000;
const MIN = 60_000;
const CFG = { timezone: 'Europe/Istanbul', day_start_hour: 4 };
const WEEK = '2026-10-12'; // a Monday
/** Noon (Istanbul) of a day counted from the reported Monday. */
const noon = (d: number) => Date.UTC(2026, 9, 12 + d, 9);
const FROM = Date.UTC(2026, 9, 12, 1); // Monday 04:00 Istanbul
const TO = FROM + 7 * DAY;
const FALLBACK_FROM = TO - 28 * DAY;

const BASE: RetentionCardFacts = {
  note_id: '',
  card_type: 'recognition',
  term_type: 'word',
  level: null,
  topics: [],
  sources: [],
  pos: [],
};

interface GroupSpec {
  f?: Partial<RetentionCardFacts>;
  /** Counted answers, one per card and day; cards answer on days start..start+6. */
  answers: number;
  /** The first `fails` answers are Again (then Good 10 minutes later). */
  fails: number;
  start?: number;
  undoFails?: boolean;
  sameDayAgain?: boolean;
  learningAgains?: number;
  deleted?: boolean;
}

interface Scenario {
  name: string;
  groups: GroupSpec[];
  expected: [RetentionDimension, string] | null;
  days?: 7 | 28;
}

function build(sc: Scenario) {
  const logsByCard: ReviewLog[][] = [];
  const facts = new Map<string, RetentionCardFacts>();
  let n = 0;
  for (const g of sc.groups) {
    let left = g.answers;
    let fails = g.fails;
    while (left > 0) {
      const id = `card-${n}`;
      const note = `note-${n}`;
      n++;
      const count = Math.min(7, left);
      left -= count;
      const start = g.start ?? 0;
      const logs: ReviewLog[] = [];
      let t = noon(start - 1);
      for (let i = 0; i < (g.learningAgains ?? 0); i++)
        logs.push(makeLog({ card_id: id, reviewed_at: (t += MIN), rating: 1 }));
      logs.push(makeLog({ card_id: id, reviewed_at: (t += MIN), rating: 4 }));
      for (let i = 0; i < count; i++) {
        const at = noon(start + i);
        if (fails > 0) {
          fails--;
          const again = makeLog({ card_id: id, reviewed_at: at, rating: 1 });
          logs.push(again);
          if (g.undoFails)
            logs.push(
              makeLog({ card_id: id, reviewed_at: at + 1000, rating: 3, undo_of: again.id }),
            );
          logs.push(makeLog({ card_id: id, reviewed_at: at + 10 * MIN, rating: 3 }));
        } else {
          logs.push(makeLog({ card_id: id, reviewed_at: at, rating: 3 }));
          if (g.sameDayAgain) {
            logs.push(makeLog({ card_id: id, reviewed_at: at + 60 * MIN, rating: 1 }));
            logs.push(makeLog({ card_id: id, reviewed_at: at + 70 * MIN, rating: 3 }));
          }
        }
      }
      logsByCard.push(logs);
      if (!g.deleted) facts.set(id, { ...BASE, ...g.f, note_id: note });
    }
  }
  const data = collectRetention(logsByCard, makeDayOf(CFG));
  return buildWeeklySummary({
    week: WEEK,
    from: FROM,
    to: TO,
    fallbackFrom: FALLBACK_FROM,
    activity: [],
    data,
    facts,
    load: null,
    newAvailable: 5,
    cards: [],
  });
}

const W = (f: Partial<RetentionCardFacts>) => f;

const SCENARIOS: Scenario[] = [
  {
    name: '1. phrases weaker than words; a tie with production goes to the earlier dimension',
    groups: [
      { f: W({ term_type: 'word' }), answers: 30, fails: 6 },
      { f: W({ term_type: 'phrase', card_type: 'production' }), answers: 25, fails: 10 },
    ],
    expected: ['term_type', 'phrase'],
  },
  {
    name: '2. a group with 19 answers is never the weakest',
    groups: [
      { f: W({ term_type: 'word' }), answers: 30, fails: 6 },
      { f: W({ term_type: 'phrase', card_type: 'production' }), answers: 19, fails: 10 },
    ],
    expected: ['term_type', 'word'],
  },
  {
    name: '3. too few answers in the week and in 28 days: no weakest category',
    groups: [{ answers: 10, fails: 5 }],
    expected: null,
  },
  {
    name: '4. a quiet week falls back to the 28 days ending with it',
    groups: [
      { f: W({ term_type: 'word' }), answers: 25, fails: 5, start: -14 },
      {
        f: W({ term_type: 'phrase', card_type: 'production' }),
        answers: 25,
        fails: 12,
        start: -14,
      },
      { f: W({ term_type: 'word' }), answers: 10, fails: 0 },
    ],
    expected: ['term_type', 'phrase'],
    days: 28,
  },
  {
    name: '5. C1 words weaker than B1 words',
    groups: [
      { f: W({ level: 'B1' }), answers: 25, fails: 2 },
      { f: W({ level: 'C1' }), answers: 25, fails: 8 },
    ],
    expected: ['level', 'C1'],
  },
  {
    name: '6. business texts weaker than travel texts',
    groups: [
      { f: W({ topics: ['travel'] }), answers: 20, fails: 2 },
      { f: W({ topics: ['business'] }), answers: 20, fails: 9 },
    ],
    expected: ['topic', 'business'],
  },
  {
    name: '7. a card from two topics counts in both',
    groups: [
      { f: W({ topics: ['travel', 'food'] }), answers: 20, fails: 8 },
      { f: W({ topics: ['travel'] }), answers: 20, fails: 0 },
    ],
    expected: ['topic', 'food'],
  },
  {
    name: '8. the "no topic" group is never the weakest',
    groups: [
      { f: W({ topics: [] }), answers: 25, fails: 20 },
      { f: W({ topics: ['sports'], card_type: 'production' }), answers: 25, fails: 5 },
    ],
    expected: ['card_type', 'recognition'],
  },
  {
    name: '9. undone misses do not count',
    groups: [
      { f: W({ pos: ['noun'] }), answers: 20, fails: 10, undoFails: true },
      { f: W({ pos: ['verb'], card_type: 'production' }), answers: 20, fails: 4 },
    ],
    expected: ['pos', 'verb'],
  },
  {
    name: '10. answers after the week do not count',
    groups: [
      { f: W({ term_type: 'word' }), answers: 20, fails: 2 },
      { f: W({ term_type: 'word' }), answers: 10, fails: 10, start: 7 },
      { f: W({ term_type: 'phrase', card_type: 'production' }), answers: 20, fails: 6 },
    ],
    expected: ['term_type', 'phrase'],
  },
  {
    name: '11. a second answer the same day does not count',
    groups: [
      { f: W({ term_type: 'word' }), answers: 20, fails: 0, sameDayAgain: true },
      { f: W({ term_type: 'phrase' }), answers: 20, fails: 5 },
    ],
    expected: ['term_type', 'phrase'],
  },
  {
    name: '12. deleted cards do not count',
    groups: [
      { f: W({ term_type: 'word' }), answers: 20, fails: 15, deleted: true },
      { f: W({ term_type: 'phrase' }), answers: 20, fails: 4 },
    ],
    expected: ['term_type', 'phrase'],
  },
  {
    name: '13. the same rate: more answers wins',
    groups: [
      { f: W({ level: 'A2' }), answers: 40, fails: 8 },
      { f: W({ level: 'B2' }), answers: 20, fails: 4 },
      { f: W({ level: 'C1' }), answers: 30, fails: 3 },
    ],
    expected: ['level', 'A2'],
  },
  {
    name: '14. one text weaker than another; hand-added words are left out',
    groups: [
      { f: W({ sources: ['s1'] }), answers: 21, fails: 8 },
      { f: W({ sources: ['s2'] }), answers: 30, fails: 10 },
      { f: W({ sources: [] }), answers: 30, fails: 0 },
    ],
    expected: ['source', 's1'],
  },
  {
    name: '15. 13/20 and 26/40 are the same rate exactly; more answers wins',
    groups: [
      { f: W({ pos: ['adjective'] }), answers: 20, fails: 7 },
      { f: W({ pos: ['adverb'] }), answers: 40, fails: 14 },
      { f: W({ pos: ['noun'] }), answers: 40, fails: 0 },
    ],
    expected: ['pos', 'adverb'],
  },
  {
    name: '16. fill-in-the-blank cards are the weak spot',
    groups: [
      { f: W({ card_type: 'cloze' }), answers: 20, fails: 10 },
      { f: W({ card_type: 'recognition' }), answers: 40, fails: 2 },
    ],
    expected: ['card_type', 'cloze'],
  },
  {
    name: '17. roots and affixes',
    groups: [
      { f: W({ term_type: 'affix' }), answers: 20, fails: 9 },
      { f: W({ term_type: 'word' }), answers: 40, fails: 4 },
    ],
    expected: ['term_type', 'affix'],
  },
  {
    name: '18. one eligible group in the week: no fallback',
    groups: [
      { f: W({ term_type: 'word' }), answers: 20, fails: 2 },
      { f: W({ term_type: 'phrase', card_type: 'production' }), answers: 15, fails: 15 },
      {
        f: W({ term_type: 'phrase', card_type: 'production' }),
        answers: 15,
        fails: 15,
        start: -14,
      },
    ],
    expected: ['term_type', 'word'],
    days: 7,
  },
  {
    name: '19. exactly 20 answers is enough, 19 is not',
    groups: [
      { f: W({ level: 'B1' }), answers: 20, fails: 10 },
      {
        f: W({ level: 'B2', term_type: 'phrase', card_type: 'production' }),
        answers: 19,
        fails: 19,
      },
      { f: W({ card_type: 'cloze' }), answers: 30, fails: 0 },
    ],
    expected: ['level', 'B1'],
  },
  {
    name: '20. Again while learning is not a memory test',
    groups: [
      { f: W({ term_type: 'word' }), answers: 20, fails: 1, learningAgains: 5 },
      { f: W({ term_type: 'phrase', card_type: 'production' }), answers: 20, fails: 4 },
    ],
    expected: ['term_type', 'phrase'],
  },
];

describe('weekly report: the weakest category (criterion 4)', () => {
  it('has 20 scenarios', () => expect(SCENARIOS).toHaveLength(20));

  let right = 0;
  for (const sc of SCENARIOS) {
    it(sc.name, () => {
      const s = build(sc);
      expect(s.weakest ? [s.weakest.dimension, s.weakest.key] : null).toEqual(sc.expected);
      if (sc.days) expect(s.groups_days).toBe(sc.days);
      if (s.weakest) expect(s.weakest.n).toBeGreaterThanOrEqual(20);
      if (s.strongest && s.weakest)
        expect(s.strongest.passed / s.strongest.n).toBeGreaterThan(s.weakest.passed / s.weakest.n);
      right++;
    });
  }
  it('names the right category in 20 of 20', () => expect(right).toBe(20));
});
