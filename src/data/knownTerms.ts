// Words the user knows without a card ("Biliyorum": from the level test, an import preview or
// by hand). Synced (known_terms), deletable; study history, so never copied to another account.
//
// Stable API for smart extraction (İP4): getKnownTermKeys() and markKnown(). The keys are
// normalised dictionary forms, the same as notes.term_norm (domain/normalize.ts).
import { senseLevel } from '../domain/level';
import { normalizeTerm } from '../domain/normalize';
import type { CefrLevel, KnownTerm, KnownTermSource, Millis } from '../domain/types';
import { db } from './db';
import { levelDataNow } from './levelData';
import { type SyncWriter, writeTx } from './writer';

/** Keys of every live known term. Never sent to the server by the import flow (privacy). */
export async function getKnownTermKeys(): Promise<Set<string>> {
  const keys = new Set<string>();
  await db.known_terms.each((k) => {
    if (k.deleted_at === null) keys.add(k.term_norm);
  });
  return keys;
}

/** Live known terms, newest first, one per key. */
export async function listKnownTerms(): Promise<KnownTerm[]> {
  const rows = (await db.known_terms.toArray()).filter((k) => k.deleted_at === null);
  const byKey = new Map<string, KnownTerm>();
  for (const k of rows.sort((a, b) => b.created_at - a.created_at)) if (!byKey.has(k.term_norm)) byKey.set(k.term_norm, k);
  return [...byKey.values()];
}

/** The level of a word from the client level file, if it is loaded. */
function levelOf(termNorm: string): CefrLevel | null {
  const data = levelDataNow();
  if (!data) return null;
  const termType = termNorm.includes(' ') ? 'phrase' : 'word';
  return senseLevel({ term_norm: termNorm, term_type: termType }, null, undefined, data)?.cefr ?? null;
}

/** Inside writeTx: mark one key, or return the live row that already has it. */
export async function markKnownIn(w: SyncWriter, termNorm: string, source: KnownTermSource): Promise<KnownTerm> {
  const rows = await db.known_terms.where('term_norm').equals(termNorm).toArray();
  const live = rows.find((r) => r.deleted_at === null);
  if (live) return live;
  // A word marked before and removed again comes back as the same row (no duplicate rows).
  const old = rows.sort((a, b) => b.updated_at - a.updated_at)[0];
  const row: KnownTerm = old
    ? { ...old, deleted_at: null, source, cefr_at_mark: old.cefr_at_mark ?? levelOf(termNorm) }
    : { ...w.base(), term_norm: termNorm, source, cefr_at_mark: levelOf(termNorm) };
  return w.put('known_terms', row);
}

/**
 * "Biliyorum" without a card. Idempotent per normalised key: a word already known keeps its
 * row. Throws on an empty term.
 */
export async function markKnown(
  term: string,
  source: 'test' | 'preview' | 'manual',
  now: Millis = Date.now(),
): Promise<KnownTerm> {
  const key = normalizeTerm(term);
  if (!key) throw new Error('empty term');
  return writeTx([db.known_terms], now, (w) => markKnownIn(w, key, source));
}

/** Remove a word from the known words (every live row of its key). Returns rows removed. */
export async function unmarkKnown(term: string, now: Millis = Date.now()): Promise<number> {
  const key = normalizeTerm(term);
  return writeTx([db.known_terms], now, async (w) => {
    let n = 0;
    for (const r of await db.known_terms.where('term_norm').equals(key).toArray()) {
      if (r.deleted_at !== null) continue;
      await w.put('known_terms', { ...r, deleted_at: now });
      n++;
    }
    return n;
  });
}
