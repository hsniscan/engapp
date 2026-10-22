// Topic keys the extract prompt may return (extract-v5, v0.3 İP2). The list is the one in
// src/domain/topics.ts (TOPIC_KEYS); the edge functions cannot import from src/, so it is
// repeated here and src/domain/topics.contract.test.ts keeps the two identical. Keys are
// never renamed or removed, only added (both places, same order).

export const EXTRACT_TOPIC_KEYS = [
  'daily_life',
  'technology',
  'science',
  'business',
  'health',
  'education',
  'travel',
  'food',
  'sports',
  'nature',
  'arts',
  'literature',
  'film',
  'games',
  'politics',
  'law',
] as const;

/** Topics one chunk may name (the device aggregates the chunks of a text). */
export const MAX_CHUNK_TOPICS = 2;

const KEYS: ReadonlySet<string> = new Set(EXTRACT_TOPIC_KEYS);

/**
 * Topic keys from the model's answer: unknown values dropped, "Daily life" / "daily-life"
 * accepted for daily_life, duplicates removed, order kept, at most MAX_CHUNK_TOPICS.
 * Same rule as parseTopics() in src/domain/topics.ts.
 */
export function cleanChunkTopics(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const key = v
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_');
    if (KEYS.has(key) && !out.includes(key)) out.push(key);
    if (out.length >= MAX_CHUNK_TOPICS) break;
  }
  return out;
}
