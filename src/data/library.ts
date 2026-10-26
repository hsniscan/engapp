// The graded reading library on this device (v0.5 contract, decision 0047). STUB: the
// library package (İP5) implements it; the reader package (İP1) shows the results on Bugün
// ("Bugünün okuması") and in Desteler → Okuma.
import type { ReadingDifficulty } from '../domain/texts';

export interface GradedSummary {
  id: string;
  title: string;
  level: string;
  topic: string;
  words: number;
  /** Expected unknown share for this user (domain/coverage.ts). */
  unknownRate: number;
}

/** Library texts that fit the user's difficulty, best first. */
export async function suggestedGradedTexts(_difficulty: ReadingDifficulty, _limit: number): Promise<GradedSummary[]> {
  return [];
}
