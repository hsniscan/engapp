// Vocabulary size counter (v0.2 İP8 "Sayaç", plan Ek A.9). Pure.
//
//   estimate = Σ_b size_b · ratio_b + words you learned or marked known outside the word list
//   to next  = ceil((0.80 − ratio_{L+1}) · size_{L+1}), at least 0
// size_b: lemmas of level b in the word list (CEFR-J + Octanove, easiest level per lemma);
// ratio_b: the level model (levelUpdate.ts) at this moment. Shown rounded to tens with "~".
import type { CefrLevel } from './types';
import { LEVELS, levelIndex } from './levelTest';
import { UP_RATIO } from './levelUpdate';

export interface VocabBand {
  level: CefrLevel;
  size: number;
  ratio: number;
  /** size × ratio, unrounded. */
  known: number;
}

export interface VocabSize {
  /** Rounded to tens. */
  estimate: number;
  bands: VocabBand[];
  /** Words outside the list that the user learned (cards in Review) or marked known. */
  outside: number;
  /** The level the counter points to (one above the user's), or null at C2. */
  next: CefrLevel | null;
  /** Words still to learn in `next` to know 80 % of it (rounded up to tens); 0 = reached. */
  toNext: number | null;
  /** Share of `next` known now. */
  nextRatio: number | null;
}

export const roundTens = (n: number): number => Math.round(n / 10) * 10;

export function vocabSize(
  level: CefrLevel,
  ratios: Record<CefrLevel, number>,
  sizes: Record<CefrLevel, number>,
  outside: number,
): VocabSize {
  const bands = LEVELS.map((b): VocabBand => {
    const ratio = Math.max(0, Math.min(1, ratios[b] ?? 0));
    const size = Math.max(0, sizes[b] ?? 0);
    return { level: b, size, ratio, known: size * ratio };
  });
  const total = bands.reduce((s, b) => s + b.known, 0) + Math.max(0, outside);
  const next = LEVELS[levelIndex(level) + 1] ?? null;
  let toNext: number | null = null;
  let nextRatio: number | null = null;
  if (next) {
    const b = bands[levelIndex(next)]!;
    nextRatio = b.ratio;
    const missing = Math.max(0, Math.ceil((UP_RATIO - b.ratio) * b.size));
    toNext = missing === 0 ? 0 : Math.max(10, Math.ceil(missing / 10) * 10);
  }
  return { estimate: roundTens(total), bands, outside: Math.max(0, outside), next, toNext, nextRatio };
}
