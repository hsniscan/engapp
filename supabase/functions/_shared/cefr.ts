// CEFR levels and level sources. No imports: the web client's sync and AI contracts use it
// without pulling in the level rule (level.ts).

export const CEFR = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
export type Cefr = (typeof CEFR)[number];

/**
 * Where a level comes from. cefrj / octanove: the list (possibly with the Turkish-learner
 * correction); ai: the model's guess, bounded by frequency; freq: frequency only; words:
 * a multi-word expression rated by its hardest word.
 */
export const LEVEL_SOURCES = ['cefrj', 'octanove', 'ai', 'freq', 'words'] as const;
export type LevelSource = (typeof LEVEL_SOURCES)[number];

export const isCefr = (v: unknown): v is Cefr =>
  typeof v === 'string' && (CEFR as readonly string[]).includes(v);

export const levelRank = (l: Cefr): number => CEFR.indexOf(l);

/** "b1 ", "B1" → "B1"; anything else → null. */
export function parseCefr(v: unknown): Cefr | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toUpperCase();
  return isCefr(s) ? s : null;
}
