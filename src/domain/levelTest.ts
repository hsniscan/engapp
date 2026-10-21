// Adaptive level test (v0.2 İP3, plan Ek A.5, docs/decisions/0017-level-test.md). Pure:
// the screen keeps a TestState and calls answerQuestion(); nothing here reads a database.
//
// A block is 8 real words of one level and 2 made-up words, shuffled. The user answers
// "Biliyorum" / "Bilmiyorum". After some "Biliyorum" answers on real words a 4-choice
// Turkish meaning question follows; a wrong choice turns that word into "unknown".
// Made-up words measure guessing: corrected = max(0, (h − f) / (1 − f)), h = yes-rate on
// a level's real words, f = yes-rate on every made-up word so far.
// After a block: corrected ≥ 0.80 → one level up, ≤ 0.50 → one level down, in between →
// the same level once more. The test stops when a boundary is bracketed (a level known
// and the one above not, each with ≥ 16 real words), or after MAX_BLOCKS blocks.
import type { CefrLevel } from './types';

export const LEVELS: readonly CefrLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
export const levelIndex = (l: CefrLevel): number => LEVELS.indexOf(l);

/** One real word of the bank with its right meaning and three wrong ones. */
export interface BankWord {
  w: string;
  pos: string;
  tr: string;
  d: [string, string, string];
}

export interface LevelTestBank {
  version: string;
  /** Lemmas per level in the word list (vocabulary estimate). */
  band_sizes: Record<CefrLevel, number>;
  levels: Record<CefrLevel, BankWord[]>;
  pseudo: string[];
}

export const REAL_PER_BLOCK = 8;
export const PSEUDO_PER_BLOCK = 2;
/** 6 blocks × 10 words + at most 10 meaning questions = at most 70 questions. */
export const MAX_BLOCKS = 6;
export const MAX_MEANING_QUESTIONS = 10;
export const MAX_MEANING_PER_BLOCK = 2;
/** Share of "Biliyorum" answers on real words that get a meaning question. */
export const MEANING_RATE = 0.3;
export const KNOWN_RATIO = 0.8;
export const DOWN_RATIO = 0.5;
/** Real words a level needs before it counts as settled. */
export const SETTLED_ITEMS = 16;
export const MAX_FALSE_ALARM = 0.2;
export const MIN_PSEUDO_FOR_RELIABLE = 6;
/** Near the next level when the next level's corrected ratio reaches this. */
export const NEAR_NEXT_RATIO = 0.6;

/** One answered word, as stored in level_tests.items. */
export interface TestItem {
  w: string;
  /** Level of a real word; null for a made-up word. */
  band: CefrLevel | null;
  pseudo: boolean;
  answer: 'yes' | 'no';
  /** Meaning question after a "yes": true = right choice. Absent = not asked. */
  mc_ok?: boolean;
}

interface Pending {
  w: string;
  band: CefrLevel | null;
  pseudo: boolean;
}

interface MeaningQuestion {
  /** Index of the item in `items`. */
  item: number;
  options: string[];
  correct: number;
}

export interface TestState {
  bankVersion: string;
  /** PRNG state (mulberry32), so the state is plain data. */
  rng: number;
  band: CefrLevel;
  /** Words of the current block still to show. */
  queue: Pending[];
  items: TestItem[];
  meaning: MeaningQuestion | null;
  meaningAsked: number;
  meaningInBlock: number;
  blocks: number;
  used: string[];
  done: boolean;
}

export type Question =
  | { kind: 'word'; w: string; pseudo: boolean; band: CefrLevel | null }
  | { kind: 'meaning'; w: string; options: string[] };

export type Answer = { kind: 'word'; known: boolean } | { kind: 'meaning'; choice: number };

// ------------------------------------------------------------------ random

/** mulberry32 step: [value in [0, 1), next state]. */
export function nextRandom(state: number): [number, number] {
  const a = (state + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, a];
}

class Rand {
  state: number;
  constructor(state: number) {
    this.state = state;
  }
  next(): number {
    const [v, s] = nextRandom(this.state);
    this.state = s;
    return v;
  }
  shuffle<T>(xs: readonly T[]): T[] {
    const a = [...xs];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  }
}

// ------------------------------------------------------------------ flow

function makeBlock(bank: LevelTestBank, band: CefrLevel, used: Set<string>, r: Rand): Pending[] {
  const real = r
    .shuffle(bank.levels[band].filter((x) => !used.has(x.w)))
    .slice(0, REAL_PER_BLOCK)
    .map((x): Pending => ({ w: x.w, band, pseudo: false }));
  const pseudo = r
    .shuffle(bank.pseudo.filter((w) => !used.has(w)))
    .slice(0, PSEUDO_PER_BLOCK)
    .map((w): Pending => ({ w, band: null, pseudo: true }));
  const block = r.shuffle([...real, ...pseudo]);
  for (const p of block) used.add(p.w);
  return block;
}

/** A new test starting at `start` (the user's current level; B1 by default). */
export function createTest(bank: LevelTestBank, start: CefrLevel, seed: number): TestState {
  const r = new Rand(seed >>> 0);
  const used = new Set<string>();
  const queue = makeBlock(bank, start, used, r);
  return {
    bankVersion: bank.version,
    rng: r.state,
    band: start,
    queue,
    items: [],
    meaning: null,
    meaningAsked: 0,
    meaningInBlock: 0,
    blocks: 1,
    used: [...used],
    done: false,
  };
}

export function currentQuestion(state: TestState): Question | null {
  if (state.done) return null;
  if (state.meaning) {
    return { kind: 'meaning', w: state.items[state.meaning.item]!.w, options: state.meaning.options };
  }
  const p = state.queue[0];
  return p ? { kind: 'word', w: p.w, pseudo: p.pseudo, band: p.band } : null;
}

/** Questions answered so far (words and meaning questions). */
export function answeredCount(state: TestState): number {
  return state.items.length + state.items.filter((i) => i.mc_ok !== undefined).length;
}

/** Rough progress for the progress bar: the test has at most MAX_BLOCKS blocks. */
export function progress(state: TestState): number {
  if (state.done) return 1;
  const words = state.items.length;
  return Math.min(0.95, words / (MAX_BLOCKS * (REAL_PER_BLOCK + PSEUDO_PER_BLOCK)));
}

export function answerQuestion(bank: LevelTestBank, state: TestState, answer: Answer): TestState {
  if (state.done) return state;
  const r = new Rand(state.rng);
  const items = [...state.items];
  let { meaning, meaningAsked, meaningInBlock, queue } = state;

  if (meaning) {
    if (answer.kind !== 'meaning') return state;
    items[meaning.item] = { ...items[meaning.item]!, mc_ok: answer.choice === meaning.correct };
    meaning = null;
  } else {
    if (answer.kind !== 'word') return state;
    const [p, ...rest] = queue;
    if (!p) return state;
    queue = rest;
    items.push({ w: p.w, band: p.band, pseudo: p.pseudo, answer: answer.known ? 'yes' : 'no' });
    if (
      answer.known &&
      !p.pseudo &&
      p.band &&
      meaningAsked < MAX_MEANING_QUESTIONS &&
      meaningInBlock < MAX_MEANING_PER_BLOCK &&
      r.next() < MEANING_RATE
    ) {
      const word = bank.levels[p.band].find((x) => x.w === p.w);
      if (word) {
        const options = r.shuffle([word.tr, ...word.d]);
        meaning = { item: items.length - 1, options, correct: options.indexOf(word.tr) };
        meaningAsked++;
        meaningInBlock++;
      }
    }
  }

  let next: TestState = { ...state, rng: r.state, items, meaning, meaningAsked, meaningInBlock, queue };
  if (!meaning && queue.length === 0) next = endBlock(bank, next, r);
  return next;
}

function endBlock(bank: LevelTestBank, state: TestState, r: Rand): TestState {
  const decision = nextBand(scoreItems(state.items), state.band, state.blocks);
  if (decision === null) return { ...state, rng: r.state, done: true };
  const used = new Set(state.used);
  const queue = makeBlock(bank, decision, used, r);
  if (queue.filter((p) => !p.pseudo).length === 0) return { ...state, rng: r.state, done: true };
  return {
    ...state,
    rng: r.state,
    band: decision,
    queue,
    meaningInBlock: 0,
    blocks: state.blocks + 1,
    used: [...used],
  };
}

/** Level of the next block, or null to stop. Exported for tests. */
export function nextBand(score: TestScore, current: CefrLevel, blocks: number): CefrLevel | null {
  if (bracketed(score) || blocks >= MAX_BLOCKS) return null;
  const c = levelIndex(current);
  const s = score.bands[current];
  const n = s?.n ?? 0;
  const ratio = s?.corrected ?? 0;
  const up = LEVELS[c + 1];
  const down = LEVELS[c - 1];
  if (ratio >= KNOWN_RATIO) {
    if (!up) return current;
    return settledUnknown(score, up) ? current : up;
  }
  if (ratio <= DOWN_RATIO) {
    if (!down) return current;
    return settledKnown(score, down) ? current : down;
  }
  if (n < SETTLED_ITEMS) return current;
  return down ?? null;
}

const settledKnown = (s: TestScore, b: CefrLevel) => {
  const x = s.bands[b];
  return !!x && x.n >= SETTLED_ITEMS && x.corrected >= KNOWN_RATIO;
};
const settledUnknown = (s: TestScore, b: CefrLevel) => {
  const x = s.bands[b];
  return !!x && x.n >= SETTLED_ITEMS && x.corrected < KNOWN_RATIO;
};

/** A level known and the one above not (each settled); or A1 not known; or C2 known. */
export function bracketed(s: TestScore): boolean {
  if (settledUnknown(s, 'A1') || settledKnown(s, 'C2')) return true;
  return LEVELS.some((b, i) => i < LEVELS.length - 1 && settledKnown(s, b) && settledUnknown(s, LEVELS[i + 1]!));
}

// ------------------------------------------------------------------ scoring

export interface BandScore {
  /** Real words shown. */
  n: number;
  /** "Biliyorum" answers that stood (a wrong meaning choice does not count). */
  yes: number;
  /** Raw yes-rate. */
  hit: number;
  /** Corrected for guessing. */
  corrected: number;
}

export interface TestScore {
  bands: Partial<Record<CefrLevel, BandScore>>;
  /** Yes-rate on made-up words. */
  falseAlarm: number;
  pseudoSeen: number;
  meaningAsked: number;
  meaningWrong: number;
}

export const correctedRatio = (hit: number, falseAlarm: number): number =>
  falseAlarm >= 1 ? 0 : Math.max(0, Math.min(1, (hit - falseAlarm) / (1 - falseAlarm)));

export function scoreItems(items: readonly TestItem[]): TestScore {
  const pseudo = items.filter((i) => i.pseudo);
  const falseAlarm = pseudo.length ? pseudo.filter((i) => i.answer === 'yes').length / pseudo.length : 0;
  const bands: Partial<Record<CefrLevel, BandScore>> = {};
  for (const b of LEVELS) {
    const mine = items.filter((i) => !i.pseudo && i.band === b);
    if (!mine.length) continue;
    const yes = mine.filter((i) => i.answer === 'yes' && i.mc_ok !== false).length;
    const hit = yes / mine.length;
    bands[b] = { n: mine.length, yes, hit, corrected: correctedRatio(hit, falseAlarm) };
  }
  const asked = items.filter((i) => i.mc_ok !== undefined);
  return {
    bands,
    falseAlarm,
    pseudoSeen: pseudo.length,
    meaningAsked: asked.length,
    meaningWrong: asked.filter((i) => i.mc_ok === false).length,
  };
}

/**
 * Ratio per level for every level: tested levels as scored; levels below the lowest tested
 * one at least 0.9 (they were skipped because the user knew the level above); levels above
 * the highest tested one halve per step.
 */
export function fullRatios(score: TestScore): Record<CefrLevel, number> {
  const tested = LEVELS.filter((b) => score.bands[b]);
  const out = {} as Record<CefrLevel, number>;
  if (!tested.length) {
    for (const b of LEVELS) out[b] = 0;
    return out;
  }
  const lo = levelIndex(tested[0]!);
  const hi = levelIndex(tested.at(-1)!);
  for (const [i, b] of LEVELS.entries()) {
    const s = score.bands[b];
    if (s) out[b] = s.corrected;
    else if (i < lo) out[b] = Math.max(0.9, score.bands[LEVELS[lo]!]!.corrected);
    else if (i > hi) out[b] = score.bands[LEVELS[hi]!]!.corrected / 2 ** (i - hi);
    else {
      // A gap between tested levels: the mean of its neighbours.
      const below = LEVELS.slice(0, i).reverse().find((x) => score.bands[x])!;
      const above = LEVELS.slice(i + 1).find((x) => score.bands[x])!;
      out[b] = (score.bands[below]!.corrected + score.bands[above]!.corrected) / 2;
    }
  }
  return out;
}

export interface TestResult {
  level: CefrLevel;
  /** Corrected ratio of every level (fullRatios). */
  ratios: Record<CefrLevel, number>;
  /** Levels the test actually showed words of. */
  tested: CefrLevel[];
  /** Ratio of the level above (null at C2). */
  nextRatio: number | null;
  /** The next level's ratio is ≥ NEAR_NEXT_RATIO. */
  nearNext: boolean;
  falseAlarm: number;
  reliable: boolean;
  /** Why the result is not reliable. */
  unreliableReason: 'guessing' | 'meanings' | 'too_short' | null;
  vocabEstimate: number;
  score: TestScore;
}

/**
 * The user's level: the highest tested level with corrected ≥ 0.80 such that every lower
 * tested level is ≥ 0.80 too (untested lower levels count as known). A1 when none is.
 */
export function resultLevel(score: TestScore): CefrLevel {
  let level: CefrLevel = 'A1';
  for (const b of LEVELS) {
    const s = score.bands[b];
    if (!s) continue;
    if (s.corrected >= KNOWN_RATIO) level = b;
    else break;
  }
  return level;
}

/** Σ size × ratio over the levels, rounded to tens (plan Ek A.9). */
export function vocabFromRatios(ratios: Record<CefrLevel, number>, sizes: Record<CefrLevel, number>, extra = 0): number {
  let sum = extra;
  for (const b of LEVELS) sum += (sizes[b] ?? 0) * (ratios[b] ?? 0);
  return Math.round(sum / 10) * 10;
}

export function scoreTest(items: readonly TestItem[], sizes: Record<CefrLevel, number>, extraKnown = 0): TestResult {
  const score = scoreItems(items);
  const level = resultLevel(score);
  const ratios = fullRatios(score);
  const next = LEVELS[levelIndex(level) + 1];
  const nextRatio = next ? ratios[next] : null;
  let unreliableReason: TestResult['unreliableReason'] = null;
  if (score.pseudoSeen < MIN_PSEUDO_FOR_RELIABLE) unreliableReason = 'too_short';
  else if (score.falseAlarm > MAX_FALSE_ALARM) unreliableReason = 'guessing';
  else if (score.meaningAsked >= 4 && score.meaningWrong / score.meaningAsked > 0.5) unreliableReason = 'meanings';
  return {
    level,
    ratios,
    tested: LEVELS.filter((b) => score.bands[b]),
    nextRatio,
    nearNext: nextRatio !== null && nextRatio >= NEAR_NEXT_RATIO,
    falseAlarm: score.falseAlarm,
    reliable: unreliableReason === null,
    unreliableReason,
    vocabEstimate: vocabFromRatios(ratios, sizes, extraKnown),
    score,
  };
}
