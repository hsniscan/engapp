import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { makeLog } from '../test/factories';
import type { DayConfig } from './day';
import { dayKeyOf } from './day';
import { createScheduler } from './fsrs';
import { replayCard } from './recompute';
import {
  biggestGapNoteIds,
  buildProgressReport,
  collectRetention,
  makeDayOf,
  MIN_ANSWERS,
  NEW_STUDY_STATE,
  nextStudyState,
  NONE_KEY,
  overallRetention,
  recognitionProductionGap,
  type RetentionCardFacts,
  retentionByGroup,
  retentionStat,
  scanCard,
  type StudyState,
  weekOf,
  weeklySeries,
  wilson,
} from './retention';
import { CardState, type RatingValue, type ReviewLog } from './types';

const CFG: DayConfig = { timezone: 'Europe/Istanbul', day_start_hour: 4 };
const DAY = 86_400_000;
const MIN = 60_000;
/** 2026-10-01 12:00 Istanbul. */
const T0 = Date.UTC(2026, 9, 1, 9);
const dayOf = makeDayOf(CFG);

function facts(p: Partial<RetentionCardFacts> & { note_id: string }): RetentionCardFacts {
  return {
    card_type: 'recognition',
    term_type: 'word',
    level: null,
    topics: [],
    sources: [],
    pos: [],
    ...p,
  };
}

/** Logs of a card that graduates on day 0 (Easy) and is then answered once a day. */
function history(cardId: string, results: boolean[], start = T0): ReviewLog[] {
  const logs = [makeLog({ card_id: cardId, reviewed_at: start, rating: 4 })];
  results.forEach((ok, i) => {
    const at = start + (i + 1) * DAY;
    logs.push(makeLog({ card_id: cardId, reviewed_at: at, rating: ok ? 3 : 1 }));
    // A missed card is relearned the same day: not the day's first answer, not counted.
    if (!ok) logs.push(makeLog({ card_id: cardId, reviewed_at: at + 10 * MIN, rating: 3 }));
  });
  return logs;
}

describe('nextStudyState', () => {
  it('follows ts-fsrs for any sequence of ratings', () => {
    const scheduler = createScheduler({ request_retention: 0.9, fsrs_params: null });
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 1, max: 4 }), fc.integer({ min: 1, max: 4000 })), {
          maxLength: 30,
        }),
        (steps) => {
          let at = T0;
          const logs = steps.map(([rating, gapMin], i) => {
            at += gapMin * MIN;
            return makeLog({
              id: `l${i}`,
              card_id: 'c',
              reviewed_at: at,
              rating: rating as RatingValue,
            });
          });
          const replay = replayCard(scheduler, { id: 'c', created_at: T0 - 1 }, logs);
          let s: StudyState = NEW_STUDY_STATE;
          for (const step of replay.steps) {
            expect(s.state).toBe(step.before.state);
            s = nextStudyState(s, step.log.rating);
            expect(s.state).toBe(step.after.state);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('counted answers', () => {
  it('counts only the first answer of a day to a card in Review', () => {
    const logs = [
      makeLog({ card_id: 'c', reviewed_at: T0, rating: 3 }), // New → Learning: no
      makeLog({ card_id: 'c', reviewed_at: T0 + MIN, rating: 3 }), // Learning → Review: no
      makeLog({ card_id: 'c', reviewed_at: T0 + DAY, rating: 1 }), // Review, first of day: yes
      makeLog({ card_id: 'c', reviewed_at: T0 + DAY + 10 * MIN, rating: 3 }), // Relearning: no
      makeLog({ card_id: 'c', reviewed_at: T0 + DAY + 20 * MIN, rating: 3 }), // Review, 2nd today: no
      makeLog({ card_id: 'c', reviewed_at: T0 + 3 * DAY, rating: 2 }), // yes
    ];
    const r = scanCard(logs, dayOf);
    expect(r.events.map((e) => [e.at, e.passed])).toEqual([
      [T0 + DAY, false],
      [T0 + 3 * DAY, true],
    ]);
    expect(r.reachedReview).toEqual({ at: T0 + MIN, day: '2026-10-01' });
  });

  it('drops undone answers and their undo rows', () => {
    const again = makeLog({ card_id: 'c', reviewed_at: T0 + DAY, rating: 1 });
    const logs = [
      makeLog({ card_id: 'c', reviewed_at: T0, rating: 4 }),
      again,
      makeLog({ card_id: 'c', reviewed_at: T0 + DAY + 1000, rating: 3, undo_of: again.id }),
      makeLog({ card_id: 'c', reviewed_at: T0 + DAY + 2000, rating: 3 }),
    ];
    expect(scanCard(logs, dayOf).events.map((e) => e.passed)).toEqual([true]);
  });

  it('uses the local day that starts at day_start_hour', () => {
    // 03:30 and 05:00 Istanbul on 3 Oct: the first belongs to 2 Oct, so both are first-of-day.
    const a = Date.UTC(2026, 9, 3, 0, 30);
    const b = Date.UTC(2026, 9, 3, 2, 0);
    const logs = [
      makeLog({ card_id: 'c', reviewed_at: T0, rating: 4 }),
      makeLog({ card_id: 'c', reviewed_at: a, rating: 3 }),
      makeLog({ card_id: 'c', reviewed_at: b, rating: 3 }),
    ];
    expect(scanCard(logs, dayOf).events.map((e) => e.day)).toEqual(['2026-10-02', '2026-10-03']);
  });

  it('fast day keys equal dayKeyOf, across DST switches and odd offsets', () => {
    const zones: DayConfig[] = [
      CFG,
      { timezone: 'Europe/Berlin', day_start_hour: 4 }, // DST ends 25 Oct 2026, 03:00
      { timezone: 'America/New_York', day_start_hour: 0 }, // DST ends 1 Nov 2026, 02:00
      { timezone: 'Asia/Kathmandu', day_start_hour: 4 }, // +05:45
      { timezone: 'Australia/Lord_Howe', day_start_hour: 2 }, // 30-minute DST, 4 Oct 2026
      { timezone: 'UTC', day_start_hour: 23 },
    ];
    for (const cfg of zones) {
      const fast = makeDayOf(cfg);
      for (let t = Date.UTC(2026, 9, 2); t < Date.UTC(2026, 10, 3); t += 7 * MIN + 13_000)
        expect(fast(t), `${cfg.timezone} ${new Date(t).toISOString()}`).toBe(dayKeyOf(t, cfg));
    }
  });
});

describe('rates', () => {
  it('Wilson 95% interval', () => {
    const ci = wilson(8, 10)!;
    expect(ci.low).toBeCloseTo(0.4902, 3);
    expect(ci.high).toBeCloseTo(0.9433, 3);
    expect(wilson(0, 0)).toBeNull();
    expect(wilson(20, 20)!.high).toBe(1);
  });

  it('marks fewer than 20 answers as not enough', () => {
    expect(retentionStat(19, 19).enough).toBe(false);
    expect(retentionStat(0, MIN_ANSWERS).enough).toBe(true);
    expect(retentionStat(0, 0).rate).toBeNull();
  });
});

describe('groups', () => {
  const data = collectRetention(
    [
      history('a', [true, true, false, true]),
      history('b', [false, false]),
      history('c', [true]),
      history('gone', [false, false, false]),
    ],
    dayOf,
  );
  const f = new Map([
    ['a', facts({ note_id: 'n1', topics: ['travel', 'food'], sources: ['s1'], pos: ['noun'] })],
    ['b', facts({ note_id: 'n2', term_type: 'phrase', topics: ['travel'], level: 'B2' })],
    ['c', facts({ note_id: 'n1', card_type: 'production', topics: ['food', 'food'] })],
  ]);

  it('counts an answer in every group of its card, and in "none" when it has none', () => {
    const topics = retentionByGroup(data, f, 'topic');
    expect(topics.map((g) => [g.key, g.passed, g.n])).toEqual([
      ['travel', 3, 6],
      ['food', 4, 5],
    ]);
    const sources = retentionByGroup(data, f, 'source');
    expect(sources.map((g) => [g.key, g.n])).toEqual([
      ['s1', 4],
      [NONE_KEY, 3],
    ]);
  });

  it('keeps natural order for term types and levels', () => {
    expect(retentionByGroup(data, f, 'term_type').map((g) => g.key)).toEqual(['word', 'phrase']);
    expect(retentionByGroup(data, f, 'level').map((g) => g.key)).toEqual(['B2', NONE_KEY]);
  });

  it('leaves out cards without facts and answers outside the window', () => {
    expect(overallRetention(data, f).n).toBe(7);
    expect(overallRetention(data, f, { from: T0 + 2.5 * DAY }).n).toBe(2);
  });
});

describe('recognition vs production', () => {
  it('compares the two directions overall and per note', () => {
    const logs: ReviewLog[][] = [];
    const f = new Map<string, RetentionCardFacts>();
    // n1: recognition 4/4, production 1/4 → gap .75; n2: 3/3 vs 2/3 → gap .33;
    // n3: production better → not listed; n4: too few answers.
    const spec: [string, boolean[], boolean[]][] = [
      ['n1', [true, true, true, true], [false, true, false, false]],
      ['n2', [true, true, true], [true, false, true]],
      ['n3', [false, true, true], [true, true, true]],
      ['n4', [true, true], [false, false]],
    ];
    for (const [note, rec, prod] of spec) {
      logs.push(history(`${note}r`, rec), history(`${note}p`, prod));
      f.set(`${note}r`, facts({ note_id: note }));
      f.set(`${note}p`, facts({ note_id: note, card_type: 'production' }));
    }
    const g = recognitionProductionGap(collectRetention(logs, dayOf), f);
    expect(g.recognition).toMatchObject({ n: 12, passed: 11 });
    expect(g.production).toMatchObject({ n: 12, passed: 6 });
    expect(g.gap).toBeNull(); // fewer than 20 answers per side
    expect(g.notes.map((n) => n.note_id)).toEqual(['n1', 'n2']);
    expect(g.notes[0]!.gap).toBeCloseTo(0.75);
    expect(biggestGapNoteIds(g, 1)).toEqual(['n1']);
  });
});

describe('weekly series', () => {
  it('counts notes by the week their first card reached Review', () => {
    const today = '2026-10-21'; // Wednesday
    const w = weekOf(today);
    expect(w).toBe('2026-10-19');
    const logs = [
      history('a', [true, false], Date.UTC(2026, 9, 12, 9)), // n1 learned week of 12 Oct
      history('b', [true], Date.UTC(2026, 9, 20, 9)), // n1 again: earlier card wins
      history('c', [true], Date.UTC(2026, 9, 20, 9)), // n2 learned week of 19 Oct
      history('d', [], Date.UTC(2026, 5, 1, 9)), // n3 learned before the series
    ];
    const f = new Map([
      ['a', facts({ note_id: 'n1' })],
      ['b', facts({ note_id: 'n1', card_type: 'production' })],
      ['c', facts({ note_id: 'n2' })],
      ['d', facts({ note_id: 'n3' })],
    ]);
    const s = weeklySeries(collectRetention(logs, dayOf), f, today);
    expect(s).toHaveLength(12);
    expect(s[11]!.week).toBe('2026-10-19');
    expect(s[0]!.week).toBe('2026-08-03');
    expect(s.slice(-2).map((p) => [p.learned, p.learnedTotal, p.n, p.passed])).toEqual([
      [1, 2, 2, 1],
      [1, 3, 2, 2],
    ]);
    expect(s[0]!.learnedTotal).toBe(1);
  });
});

describe('performance', () => {
  it('computes the whole report for 5,000 cards in under 200 ms', () => {
    const logs: ReviewLog[][] = [];
    const f = new Map<string, RetentionCardFacts>();
    const start = Date.UTC(2026, 5, 15, 9);
    for (let c = 0; c < 5000; c++) {
      const id = `c${c}`;
      const results = Array.from({ length: 10 }, (_, i) => (c * 7 + i * 3) % 10 !== 0);
      const card: ReviewLog[] = [
        makeLog({ card_id: id, reviewed_at: start + c * 1000, rating: 4 }),
      ];
      results.forEach((ok, i) => {
        card.push(
          makeLog({
            card_id: id,
            reviewed_at: start + c * 1000 + (i + 1) * 11 * DAY,
            rating: ok ? 3 : 1,
          }),
        );
      });
      logs.push(card);
      f.set(
        id,
        facts({
          note_id: `n${c >> 1}`,
          card_type: c % 2 ? 'production' : 'recognition',
          level: (['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const)[c % 6]!,
          topics: [['travel', 'food', 'science'][c % 3]!],
          sources: [`s${c % 40}`],
          pos: [c % 4 ? 'noun' : 'verb'],
        }),
      );
    }
    const now = Date.UTC(2026, 9, 21, 9);
    // Best of three (the first run includes JIT warm-up; a busy machine adds noise).
    let ms = Infinity;
    let report = null as ReturnType<typeof buildProgressReport> | null;
    for (let run = 0; run < 3; run++) {
      const t0 = performance.now();
      const data = collectRetention(logs, makeDayOf(CFG));
      report = buildProgressReport(data, f, { now, today: '2026-10-21' });
      ms = Math.min(ms, performance.now() - t0);
    }
    report = report!;
    expect(report.groups.level).toHaveLength(6);
    expect(report.overall.n).toBeGreaterThan(1000);
    expect(ms).toBeLessThan(200);
  });
});

describe('state constants', () => {
  it('a Review card stays in Review unless forgotten', () => {
    const r = { state: CardState.Review, step: 0 } as const;
    expect(nextStudyState(r, 2).state).toBe(CardState.Review);
    expect(nextStudyState(r, 1).state).toBe(CardState.Relearning);
  });
});
