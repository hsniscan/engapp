import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  answerQuestion,
  answeredCount,
  bracketed,
  correctedRatio,
  createTest,
  currentQuestion,
  fullRatios,
  LEVELS,
  levelIndex,
  MAX_BLOCKS,
  nextRandom,
  resultLevel,
  scoreItems,
  scoreTest,
  type LevelTestBank,
  type TestItem,
  type TestState,
} from './levelTest';
import type { CefrLevel } from './types';

const SIZES: Record<CefrLevel, number> = { A1: 1000, A2: 1200, B1: 2000, B2: 2400, C1: 900, C2: 900 };

function fakeBank(): LevelTestBank {
  const levels = {} as LevelTestBank['levels'];
  for (const b of LEVELS) {
    levels[b] = Array.from({ length: 200 }, (_, i) => ({
      w: `${b.toLowerCase()}w${i}`,
      pos: 'noun',
      tr: `${b}-anlam-${i}`,
      d: [`${b}-x-${i}`, `${b}-y-${i}`, `${b}-z-${i}`] as [string, string, string],
    }));
  }
  return {
    version: 'test',
    band_sizes: SIZES,
    levels,
    pseudo: Array.from({ length: 300 }, (_, i) => `plinder${i}`),
  };
}
const bank = fakeBank();

/** A simulated user: answers by a probability per question. */
interface User {
  knows: (band: CefrLevel) => number;
  pseudoYes: number;
  /** Chance of the right meaning when the word is not really known (a guess). */
  guessRight: number;
}

/** Honest user with a true level: knows lower levels, half of the next, little above. */
function honest(level: CefrLevel): User {
  const L = levelIndex(level);
  return {
    knows: (b) => {
      const d = levelIndex(b) - L;
      return d <= -1 ? 0.97 : d === 0 ? 0.9 : d === 1 ? 0.45 : d === 2 ? 0.15 : 0.05;
    },
    pseudoYes: 0.03,
    guessRight: 0.25,
  };
}

function run(user: User, start: CefrLevel, seed: number): { state: TestState; questions: number } {
  let state = createTest(bank, start, seed);
  let rnd = (seed ^ 0x9e3779b9) >>> 0;
  const rand = () => {
    const [v, s] = nextRandom(rnd);
    rnd = s;
    return v;
  };
  const knownWords = new Map<string, boolean>();
  let questions = 0;
  for (let guard = 0; guard < 500; guard++) {
    const q = currentQuestion(state);
    if (!q) break;
    questions++;
    if (q.kind === 'word') {
      const knows = q.pseudo ? rand() < user.pseudoYes : rand() < user.knows(q.band!);
      knownWords.set(q.w, !q.pseudo && rand() < 1 && knows && (q.pseudo ? false : true));
      state = answerQuestion(bank, state, { kind: 'word', known: knows });
    } else {
      const word = Object.values(bank.levels)
        .flat()
        .find((x) => x.w === q.w)!;
      const reallyKnows = rand() < 0.95;
      const right = reallyKnows || rand() < user.guessRight;
      const choice = right ? q.options.indexOf(word.tr) : q.options.findIndex((o) => o !== word.tr);
      state = answerQuestion(bank, state, { kind: 'meaning', choice });
    }
  }
  return { state, questions };
}

describe('corrected ratio', () => {
  it('subtracts guessing', () => {
    expect(correctedRatio(0.9, 0)).toBe(0.9);
    expect(correctedRatio(0.9, 0.5)).toBeCloseTo(0.8);
    expect(correctedRatio(0.4, 0.5)).toBe(0);
    expect(correctedRatio(1, 1)).toBe(0);
  });

  it('stays in [0, 1] and never exceeds the raw rate', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), (h, f) => {
        const c = correctedRatio(h, f);
        return c >= 0 && c <= 1 && c <= h + 1e-12;
      }),
    );
  });
});

describe('test flow', () => {
  it('a block is 8 real and 2 made-up words, no word twice', () => {
    const { state } = run(honest('B1'), 'B1', 1);
    const words = state.items.map((i) => i.w);
    expect(new Set(words).size).toBe(words.length);
    for (let i = 0; i < state.items.length; i += 10) {
      const block = state.items.slice(i, i + 10);
      expect(block.filter((x) => x.pseudo)).toHaveLength(2);
      expect(new Set(block.filter((x) => !x.pseudo).map((x) => x.band)).size).toBe(1);
    }
  });

  it('ends within 70 questions and MAX_BLOCKS blocks for any answers', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 31 }), fc.constantFrom(...LEVELS), fc.array(fc.boolean(), { minLength: 80, maxLength: 80 }), (seed, start, answers) => {
        let state = createTest(bank, start, seed);
        let k = 0;
        let q = currentQuestion(state);
        let n = 0;
        while (q && n < 200) {
          n++;
          const a = answers[k++ % answers.length]!;
          state = answerQuestion(
            bank,
            state,
            q.kind === 'word' ? { kind: 'word', known: a } : { kind: 'meaning', choice: a ? 0 : 1 },
          );
          q = currentQuestion(state);
        }
        return state.done && n <= 70 && answeredCount(state) === n && state.blocks <= MAX_BLOCKS;
      }),
      { numRuns: 300 },
    );
  });

  it('a wrong meaning choice turns the word into unknown', () => {
    let state = createTest(bank, 'B1', 3);
    // Answer "yes" until a meaning question appears, then pick a wrong option.
    for (let i = 0; i < 40; i++) {
      const q = currentQuestion(state)!;
      if (q.kind === 'meaning') {
        const word = bank.levels.B1.find((x) => x.w === q.w)!;
        state = answerQuestion(bank, state, { kind: 'meaning', choice: q.options.findIndex((o) => o !== word.tr) });
        const item = state.items.find((x) => x.w === q.w)!;
        expect(item).toMatchObject({ answer: 'yes', mc_ok: false });
        expect(scoreItems([item]).bands.B1!.yes).toBe(0);
        return;
      }
      state = answerQuestion(bank, state, { kind: 'word', known: true });
    }
    throw new Error('no meaning question in 40 answers');
  });

  it('ignores an answer of the wrong kind', () => {
    const state = createTest(bank, 'B1', 4);
    expect(answerQuestion(bank, state, { kind: 'meaning', choice: 0 })).toBe(state);
  });
});

describe('simulated users', () => {
  it('honest users get their level (most seeds) and a reliable result', () => {
    for (const level of LEVELS) {
      let exact = 0;
      let within1 = 0;
      let reliable = 0;
      const N = 200;
      for (let seed = 0; seed < N; seed++) {
        const { state } = run(honest(level), 'B1', seed * 7919 + levelIndex(level));
        const r = scoreTest(state.items, SIZES);
        if (r.level === level) exact++;
        if (Math.abs(levelIndex(r.level) - levelIndex(level)) <= 1) within1++;
        if (r.reliable) reliable++;
      }
      expect(exact / N, `exact ${level}`).toBeGreaterThanOrEqual(0.7);
      expect(within1 / N, `within one ${level}`).toBeGreaterThanOrEqual(0.97);
      expect(reliable / N, `reliable ${level}`).toBeGreaterThanOrEqual(0.9);
    }
  });

  it('an always-yes user is never reliable', () => {
    const yes: User = { knows: () => 1, pseudoYes: 1, guessRight: 0.25 };
    for (let seed = 0; seed < 300; seed++) {
      const { state } = run(yes, 'B1', seed);
      const r = scoreTest(state.items, SIZES);
      expect(r.reliable).toBe(false);
      expect(r.falseAlarm).toBeGreaterThan(0.2);
    }
  });

  it('an always-no user ends at A1 with a small vocabulary', () => {
    const no: User = { knows: () => 0, pseudoYes: 0, guessRight: 0 };
    for (let seed = 0; seed < 100; seed++) {
      const { state, questions } = run(no, 'B1', seed);
      const r = scoreTest(state.items, SIZES);
      expect(r.level).toBe('A1');
      expect(r.vocabEstimate).toBe(0);
      expect(questions).toBeLessThanOrEqual(70);
    }
  });

  it('test–retest: two runs differ by at most one level in ≥ 95% of 1 000 seeds', () => {
    let stable = 0;
    for (let seed = 0; seed < 1000; seed++) {
      const level = LEVELS[seed % LEVELS.length]!;
      const a = scoreTest(run(honest(level), 'B1', seed * 2 + 1).state.items, SIZES);
      // The second run starts at the first result, as the app does.
      const b = scoreTest(run(honest(level), a.level, seed * 2 + 2).state.items, SIZES);
      if (Math.abs(levelIndex(a.level) - levelIndex(b.level)) <= 1) stable++;
    }
    expect(stable / 1000).toBeGreaterThanOrEqual(0.95);
  });

  it('a typical honest run is short (about 5 minutes)', () => {
    let total = 0;
    for (let seed = 0; seed < 300; seed++) total += run(honest(LEVELS[seed % 6]!), 'B1', seed).questions;
    // ~4 s per question → ≤ 60 questions on average keeps the test near 4–5 minutes.
    expect(total / 300).toBeLessThanOrEqual(60);
  });
});

describe('scoring rules', () => {
  const item = (band: CefrLevel | null, yes: boolean, mc?: boolean): TestItem => ({
    w: `${band}-${Math.random()}`,
    band,
    pseudo: band === null,
    answer: yes ? 'yes' : 'no',
    ...(mc === undefined ? {} : { mc_ok: mc }),
  });
  const many = (band: CefrLevel | null, yes: number, total: number) =>
    Array.from({ length: total }, (_, i) => item(band, i < yes));

  it('level = highest known level with every lower tested level known', () => {
    const items = [...many('A2', 16, 16), ...many('B1', 15, 16), ...many('B2', 6, 16), ...many(null, 0, 6)];
    expect(resultLevel(scoreItems(items))).toBe('B1');
    // A weak lower level caps the result.
    const capped = [...many('A2', 10, 16), ...many('B1', 15, 16), ...many(null, 0, 6)];
    expect(resultLevel(scoreItems(capped))).toBe('A1');
  });

  it('brackets a boundary only with 16 real words on each side', () => {
    expect(bracketed(scoreItems([...many('B1', 16, 16), ...many('B2', 2, 8)]))).toBe(false);
    expect(bracketed(scoreItems([...many('B1', 16, 16), ...many('B2', 4, 16)]))).toBe(true);
  });

  it('fills untested levels: lower ≥ 0.9, higher halves per step', () => {
    const r = fullRatios(scoreItems([...many('B1', 16, 16), ...many('B2', 8, 16)]));
    expect(r.A1).toBeGreaterThanOrEqual(0.9);
    expect(r.B2).toBeCloseTo(0.5);
    expect(r.C1).toBeCloseTo(0.25);
    expect(r.C2).toBeCloseTo(0.125);
  });

  it('marks guessing, too many wrong meanings and too short tests as unreliable', () => {
    const base = [...many('B1', 16, 16)];
    expect(scoreTest([...base, ...many(null, 2, 6)], SIZES).unreliableReason).toBe('guessing');
    expect(scoreTest([...base, ...many(null, 0, 4)], SIZES).unreliableReason).toBe('too_short');
    const wrongMeanings = [...base, ...Array.from({ length: 5 }, () => item('B1', true, false)), ...many(null, 0, 6)];
    expect(scoreTest(wrongMeanings, SIZES).unreliableReason).toBe('meanings');
    expect(scoreTest([...base, ...many(null, 1, 6)], SIZES).reliable).toBe(true);
  });

  it('vocabulary estimate is monotone in the answers (property)', () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { minLength: 32, maxLength: 32 }), fc.integer({ min: 0, max: 31 }), (answers, flip) => {
        const items = answers.map((a, i) => item(i < 16 ? 'B1' : 'B2', a));
        const more = items.map((x, i) => (i === flip ? { ...x, answer: 'yes' as const } : x));
        const pseudo = many(null, 0, 6);
        return scoreTest([...more, ...pseudo], SIZES).vocabEstimate >= scoreTest([...items, ...pseudo], SIZES).vocabEstimate;
      }),
    );
  });
});
