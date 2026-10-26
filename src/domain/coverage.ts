// How much of a text the user knows (v0.5 contract, decision 0043). Pure.
//
// The reader (İP1) owns tokenising and the knowledge model (data/knowledge.ts); the graded
// library (İP5) and the daily story (İP8) reuse measureCoverage and fitsBand so every screen
// measures a text the same way.
import { DIFFICULTY_BANDS, UNKNOWN_RATE_CAP, type CoverageResult, type ReadingDifficulty } from './texts';

/**
 * `lemmaCounts`: running-word counts per lemma, already without numbers, punctuation and
 * proper nouns. `pKnown`: probability 0..1 that the user knows the lemma.
 */
export function measureCoverage(
  lemmaCounts: ReadonlyMap<string, number>,
  pKnown: (lemma: string) => number,
): CoverageResult {
  let tokens = 0;
  let unknown = 0;
  const misses: { lemma: string; weight: number }[] = [];
  for (const [lemma, n] of lemmaCounts) {
    if (n <= 0) continue;
    const p = Math.min(1, Math.max(0, pKnown(lemma)));
    tokens += n;
    unknown += n * (1 - p);
    if (p < 0.5) misses.push({ lemma, weight: n * (1 - p) });
  }
  misses.sort((a, b) => b.weight - a.weight || a.lemma.localeCompare(b.lemma));
  return {
    tokens,
    unknownRate: tokens === 0 ? 0 : unknown / tokens,
    unknownLemmas: misses.map((m) => m.lemma),
  };
}

/** -1 = easier than the band, 0 = inside it, 1 = harder than the band or over the 10 % cap. */
export function bandFit(unknownRate: number, difficulty: ReadingDifficulty): -1 | 0 | 1 {
  const band = DIFFICULTY_BANDS[difficulty];
  if (unknownRate > Math.min(band.max, UNKNOWN_RATE_CAP)) return 1;
  if (unknownRate < band.min) return -1;
  return 0;
}
