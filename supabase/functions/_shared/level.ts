// Word level rule (v0.2 İP2). The only place that decides a word's CEFR level; the AI's
// guess is one input, never the decision (plan, coding-agent rule 2). Pure TypeScript,
// shared by the edge functions, the server-side level job and the web client
// (src/domain/level.ts re-exports it), so every side computes the same level.
//
//   1. The word (with its part of speech) is in the CEFR-J or Octanove list: the list level,
//      moved by the Turkish-learner correction when there is one (at most one step).
//   2. A multi-word expression that is not in the list: the AI guess or the level of its
//      hardest word, whichever is higher.
//   3. Otherwise the AI guess, bounded by frequency: Zipf >= 5 at most B1, Zipf < 3 at least
//      C1, and never more than two bands away from the frequency band.
//   4. No guess: the frequency band (ZIPF_THRESHOLDS).
//
// A user's manual level (notes.level_override) is applied by the client on top of this and
// only for that user.

import { CEFR, isCefr, levelRank, type Cefr, type LevelSource } from './cefr.ts';
import { FUNCTION_WORDS, lemmaForms } from './tokenize.ts';

export { CEFR, isCefr, LEVEL_SOURCES, levelRank, type Cefr, type LevelSource } from './cefr.ts';

const at = (i: number): Cefr => CEFR[Math.max(0, Math.min(CEFR.length - 1, i))]!;
export const maxLevel = (a: Cefr, b: Cefr): Cefr => (levelRank(a) >= levelRank(b) ? a : b);
export const minLevel = (a: Cefr, b: Cefr): Cefr => (levelRank(a) <= levelRank(b) ? a : b);

/** Moves `to` towards `from` until it is at most `steps` bands away. */
export function clampSteps(from: Cefr, to: Cefr, steps: number): Cefr {
  const d = levelRank(to) - levelRank(from);
  if (Math.abs(d) <= steps) return to;
  return at(levelRank(from) + Math.sign(d) * steps);
}

/** The Turkish-learner correction may move a list level by one step at most. */
export const MAX_TR_STEPS = 1;
export const clampTrCorrection = (list: Cefr, proposed: Cefr): Cefr =>
  clampSteps(list, proposed, MAX_TR_STEPS);

// ---------------------------------------------------------------------------
// Frequency
// ---------------------------------------------------------------------------

/**
 * Lowest Zipf value of A1, A2, B1, B2 and C1; below the last one is C2. Fitted on the list
 * itself by scripts/build-levels.ts (fitZipfThresholds over 8 545 single-word lemmas: the
 * smallest mean distance between frequency band and list level). Exact agreement 40 %,
 * within one band 86 % (the plan's first guess 5.5/5.0/4.5/4.0/3.3: 28 % and 68 %).
 * Frequency cannot tell C1 from C2, so C2 needs a very rare word. See
 * docs/decisions/0012-word-levels.md and data/levels/manifest.json.
 */
export const ZIPF_THRESHOLDS: readonly number[] = [5.24, 4.63, 3.89, 3.01, 1.62];

/**
 * The frequency data (server table ref_word_freq and the client file) holds every word at or
 * above this Zipf value. Below it the bands only tell C1 (>= 1.62) from C2, which frequency
 * cannot do reliably anyway, so a plain word missing from the data is treated as just below.
 */
export const FREQ_MIN_ZIPF = 3.0;

/** AI guesses for very frequent words are capped, rare words are floored (plan İP2). */
export const ZIPF_EASY = 5; // Zipf >= 5: at most B1
export const ZIPF_RARE = 3; // Zipf < 3: at least C1
/** An AI guess stays within this many bands of the frequency band. */
export const AI_MAX_STEPS_FROM_FREQ = 2;

export function zipfBand(zipf: number, thresholds: readonly number[] = ZIPF_THRESHOLDS): Cefr {
  for (let i = 0; i < thresholds.length; i++) if (zipf >= thresholds[i]!) return CEFR[i]!;
  return 'C2';
}

/**
 * Thresholds with the smallest total distance |band − list level| (an ordinal fit: plain
 * exact agreement collapses C1, whose words are as frequent as C2's). Dynamic programme
 * over the distinct Zipf values (highest first): six consecutive groups labelled A1..C2.
 * Returns the lowest Zipf of each of the first five groups.
 */
export function fitZipfThresholds(points: { zipf: number; cefr: Cefr }[]): number[] {
  const values = [...new Set(points.map((p) => p.zipf))].sort((a, b) => b - a);
  const index = new Map(values.map((v, i) => [v, i]));
  const V = values.length;
  const K = CEFR.length;
  // counts[i][c]: points with list level c at value i; cost[k][i]: total distance of the
  // first i values when all of them are put in band k.
  const counts = Array.from({ length: V }, () => new Array<number>(K).fill(0));
  for (const p of points) counts[index.get(p.zipf)!]![levelRank(p.cefr)]!++;
  const cost = Array.from({ length: K }, () => new Array<number>(V + 1).fill(0));
  for (let k = 0; k < K; k++)
    for (let i = 0; i < V; i++) {
      let s = 0;
      for (let c = 0; c < K; c++) s += counts[i]![c]! * Math.abs(k - c);
      cost[k]![i + 1] = cost[k]![i]! + s;
    }
  const dp = Array.from({ length: K }, () => new Array<number>(V + 1).fill(Infinity));
  const from = Array.from({ length: K }, () => new Array<number>(V + 1).fill(0));
  for (let i = 0; i <= V; i++) dp[0]![i] = cost[0]![i]!;
  for (let k = 1; k < K; k++) {
    for (let i = 0; i <= V; i++) {
      let best = Infinity;
      let arg = 0;
      for (let j = 0; j <= i; j++) {
        const s = dp[k - 1]![j]! + cost[k]![i]! - cost[k]![j]!;
        if (s < best) {
          best = s;
          arg = j;
        }
      }
      dp[k]![i] = best;
      from[k]![i] = arg;
    }
  }
  // Group k covers values [start_k, start_{k+1}).
  const starts = new Array<number>(K).fill(0);
  let i = V;
  for (let k = K - 1; k >= 1; k--) {
    starts[k] = from[k]![i]!;
    i = starts[k]!;
  }
  const th: number[] = [];
  for (let k = 0; k < K - 1; k++) {
    const end = starts[k + 1]!; // first value of the next group
    const prev = th.length ? th[th.length - 1]! : (values[0] ?? 0) + 0.01;
    th.push(end > 0 ? Math.min(prev, values[end - 1]!) : prev);
  }
  return th.map((t) => Math.round(t * 100) / 100);
}

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

/** One list entry of a lemma. tr_cefr / tr_reason: the Turkish-learner correction, if any. */
export interface RefEntry {
  /** Part of speech in our names (noun, verb, adjective, ..., other). */
  pos: string;
  cefr: Cefr;
  source: 'cefrj' | 'octanove';
  tr_cefr?: Cefr | null;
  tr_reason?: string | null;
}

export interface WordRefs {
  refs: RefEntry[];
  zipf: number | null;
}

/** Reference data for a lemma; undefined when neither the list nor the frequency data has it. */
export type RefLookup = (lemmaNorm: string) => WordRefs | undefined;

export interface FreqCoverage {
  /**
   * The frequency data holds every single word at or above this Zipf value, so a plain word
   * that is missing from it is rarer. null: nothing can be inferred from a missing word.
   */
  minZipf: number | null;
}

/** Lexicon part of speech → list part of speech; null = any. */
export function listPos(pos: string | null | undefined): string | null {
  switch (pos) {
    case 'noun':
    case 'verb':
    case 'adjective':
    case 'adverb':
    case 'preposition':
    case 'conjunction':
    case 'pronoun':
    case 'determiner':
    case 'interjection':
      return pos;
    case 'phrasal verb':
      return 'verb';
    default:
      return null;
  }
}

export interface ListLevel {
  /** Level shown: the list level, or the corrected one. */
  cefr: Cefr;
  source: 'cefrj' | 'octanove';
  /** The list's own level (before the Turkish-learner correction). */
  list_cefr: Cefr;
  /** Short Turkish reason of the correction; null when the list level is kept. */
  reason_tr: string | null;
}

/**
 * The list level of a lemma: entries with the same part of speech, else all entries; the
 * easiest one (CEFR-J before Octanove on a tie), then its Turkish-learner correction
 * (clamped to one step here as well, whatever was stored).
 */
export function listLevel(refs: RefEntry[] | undefined, pos: string | null): ListLevel | null {
  if (!refs || refs.length === 0) return null;
  const p = listPos(pos);
  const same = p ? refs.filter((r) => r.pos === p) : [];
  const pool = same.length ? same : refs;
  const best = [...pool].sort(
    (a, b) =>
      levelRank(a.cefr) - levelRank(b.cefr) ||
      (a.source === b.source ? 0 : a.source === 'cefrj' ? -1 : 1),
  )[0]!;
  const tr = best.tr_cefr && isCefr(best.tr_cefr) ? clampTrCorrection(best.cefr, best.tr_cefr) : null;
  return {
    cefr: tr ?? best.cefr,
    source: best.source,
    list_cefr: best.cefr,
    reason_tr: tr && tr !== best.cefr ? (best.tr_reason?.trim() || null) : null,
  };
}

/** Pattern slots that are not words of the expression. */
const SLOTS = new Set([
  "one's",
  'oneself',
  'someone',
  "someone's",
  'somebody',
  "somebody's",
  'something',
  'sb',
  "sb's",
  'sth',
  'smb',
  'smth',
  'doing',
  'do',
]);

/** Is this a single plain word (no space, no hyphen)? Only those can be looked up by frequency. */
export const isPlainWord = (lemma: string): boolean => /^[\p{L}']+$/u.test(lemma);

/** The words of a multi-word expression worth rating: no function words, no slots. */
export function contentWords(lemmaNorm: string): string[] {
  const words = lemmaNorm
    .split(/[\s-]+/)
    .map((w) => w.replace(/^[^\p{L}]+|[^\p{L}']+$/gu, ''))
    .filter(Boolean);
  const content = words.filter((w) => !FUNCTION_WORDS.has(w) && !SLOTS.has(w));
  return [...new Set(content.length ? content : words.filter((w) => !SLOTS.has(w)))];
}

/** Lemmas whose reference data the rule may need for this term (itself, plus its words and their base forms). */
export function lemmasNeeded(lemmaNorm: string): string[] {
  const out = new Set([lemmaNorm]);
  if (!isPlainWord(lemmaNorm)) {
    for (const w of contentWords(lemmaNorm)) for (const f of lemmaForms(w)) out.add(f);
  }
  return [...out];
}

// ---------------------------------------------------------------------------
// The rule
// ---------------------------------------------------------------------------

export interface LevelQuery {
  lemma_norm: string;
  term_type: 'word' | 'phrase' | 'pattern';
  /** Part of speech of the sense (lexicon names); null when unknown. */
  pos: string | null;
  /** The model's guess for a new sense (extract-v3 / enrich-v2 / level-guess-v1). */
  cefr_guess: Cefr | null;
}

export interface ResolvedLevel {
  cefr: Cefr;
  source: LevelSource;
  /** The list level before the Turkish-learner correction (list sources only). */
  list_cefr: Cefr | null;
  /** Reason of the Turkish-learner correction (list sources only). */
  reason_tr: string | null;
}

/** Frequency of a plain word; a word missing from data that covers Zipf >= minZipf is rarer. */
function zipfOf(lemma: string, lookup: RefLookup, coverage: FreqCoverage): number | null {
  const z = lookup(lemma)?.zipf;
  if (typeof z === 'number' && Number.isFinite(z)) return z;
  if (coverage.minZipf !== null && isPlainWord(lemma)) return coverage.minZipf - 0.01;
  return null;
}

/** AI guess bounded by frequency (rule 3). */
export function boundGuess(guess: Cefr, zipf: number | null): Cefr {
  if (zipf === null) return guess;
  let g = clampSteps(zipfBand(zipf), guess, AI_MAX_STEPS_FROM_FREQ);
  if (zipf >= ZIPF_EASY) g = minLevel(g, 'B1');
  if (zipf < ZIPF_RARE) g = maxLevel(g, 'C1');
  return g;
}

/** Level of one word inside an expression: its list level, else its frequency band. */
function wordLevel(word: string, lookup: RefLookup, coverage: FreqCoverage): Cefr | null {
  for (const f of lemmaForms(word)) {
    const l = listLevel(lookup(f)?.refs, null);
    if (l) return l.cefr;
  }
  for (const f of lemmaForms(word)) {
    const z = lookup(f)?.zipf;
    if (typeof z === 'number') return zipfBand(z);
  }
  const z = zipfOf(word, lookup, coverage);
  return z === null ? null : zipfBand(z);
}

/**
 * The level of a sense, or null when nothing is known (no list entry, no guess, no
 * frequency). `coverage.minZipf`: see FreqCoverage.
 */
export function resolveLevel(
  q: LevelQuery,
  lookup: RefLookup,
  coverage: FreqCoverage = { minZipf: null },
): ResolvedLevel | null {
  const lemma = q.lemma_norm;
  const guess = isCefr(q.cefr_guess) ? q.cefr_guess : null;

  // 1. In the list (multi-word list entries like "according to" too).
  const list = listLevel(lookup(lemma)?.refs, q.pos);
  if (list) {
    return { cefr: list.cefr, source: list.source, list_cefr: list.list_cefr, reason_tr: list.reason_tr };
  }

  // 2. Multi-word expressions (and hyphenated compounds): the guess or the hardest word.
  if (!isPlainWord(lemma) || q.term_type !== 'word') {
    let parts: Cefr | null = null;
    for (const w of contentWords(lemma)) {
      const l = wordLevel(w, lookup, coverage);
      if (l) parts = parts ? maxLevel(parts, l) : l;
    }
    if (guess && (!parts || levelRank(guess) >= levelRank(parts)))
      return { cefr: guess, source: 'ai', list_cefr: null, reason_tr: null };
    if (parts) return { cefr: parts, source: 'words', list_cefr: null, reason_tr: null };
    return null;
  }

  // 3. / 4. A single word outside the list.
  const zipf = zipfOf(lemma, lookup, coverage);
  if (guess) return { cefr: boundGuess(guess, zipf), source: 'ai', list_cefr: null, reason_tr: null };
  if (zipf !== null) return { cefr: zipfBand(zipf), source: 'freq', list_cefr: null, reason_tr: null };
  return null;
}
