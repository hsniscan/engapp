// Column limits of the server tables (supabase/migrations/20261021000100_user_tables.sql).
// A row over a limit is rejected by sync_push on every attempt and never leaves the device,
// so the data layer refuses such values up front. Lengths are in code points, like
// Postgres char_length().
export const LIMITS = {
  term: 200,
  ipa: 200,
  tags: 50,
  pos: 40,
  gloss_en: 300,
  meaning_tr: 500,
  source_sentence: 2000,
  source_sentence_tr: 2000,
  source_title: 500,
  file_name: 500,
} as const;

/**
 * Longest term the add forms let the user type (review 2026-11-26, ekle.md #13). The column
 * takes 200 (`LIMITS.term`, for imports and long patterns), but a word, phrasal verb or
 * pattern typed by hand is far shorter; past this the field stops and its counter shows why.
 */
export const TYPED_TERM_MAX = 80;

/**
 * "12 / 500" once a typed value is near its limit (the last fifth), else null: a field that
 * silently stops taking characters looks broken.
 */
export function charCountNearLimit(
  value: string,
  max: number,
): { count: number; max: number } | null {
  const count = codePoints(value);
  return count >= Math.ceil(max * 0.8) ? { count, max } : null;
}

export function codePoints(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

/** Name of the first field over its limit, or null. `null`/`undefined` values pass. */
export function overLimit(
  fields: Record<string, { value: string | null | undefined; max: number }>,
): string | null {
  for (const [name, { value, max }] of Object.entries(fields)) {
    if (typeof value === 'string' && codePoints(value) > max) return name;
  }
  return null;
}

export function truncateCodePoints(s: string, max: number): string {
  return codePoints(s) <= max ? s : [...s].slice(0, max).join('');
}
