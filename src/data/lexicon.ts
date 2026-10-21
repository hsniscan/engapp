// Read side of the local lexicon cache (shared dictionary rows pulled by sync or returned
// by ai-extract / ai-enrich). Never written with user text.
import { normalizeTerm } from '../domain/normalize';
import type { LexiconSense } from '../domain/types';
import { db } from './db';

/** Cached lexicon senses whose lemma equals the typed term (normalized). */
export async function findLexiconSenses(term: string): Promise<LexiconSense[]> {
  const norm = normalizeTerm(term);
  if (!norm) return [];
  return db.lexicon_cache.where('lemma_norm').equals(norm).toArray();
}

export async function cacheLexiconSenses(rows: LexiconSense[]): Promise<void> {
  if (rows.length) await db.lexicon_cache.bulkPut(rows);
}
