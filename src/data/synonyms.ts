// Accepted synonyms for a typed answer (v0.5 İP9, ADR 0051), data side: the dictionary rows on
// this device whose headword is what the user typed. Read-only, offline, indexed lookups:
// the Kelime Bankası list (word_bank.lemma_norm), the cached shared lexicon
// (lexicon_cache.lemma_norm) and the user's own words (notes.term_norm). The rule is
// domain/synonyms.ts.
import { normalizeTerm } from '../domain/normalize';
import { acceptedSynonyms, type SynonymEntry, type SynonymTarget } from '../domain/synonyms';
import { db } from './db';

/** Headword spellings to look up for a typed answer: as typed, and without "to"/"a"/"the". */
export function lookupKeys(typed: string): string[] {
  const n = normalizeTerm(typed).replace(/[.!?,;:]+$/g, '');
  const keys = new Set<string>();
  if (n) keys.add(n);
  const bare = n.replace(/^(?:to|a|an|the) /, '');
  if (bare) keys.add(bare);
  return [...keys];
}

/** Dictionary entries on this device spelled like `typed` (any of lookupKeys). */
export async function synonymEntries(typed: string): Promise<SynonymEntry[]> {
  const keys = lookupKeys(typed);
  if (keys.length === 0) return [];
  return db.transaction('r', [db.word_bank, db.lexicon_cache, db.notes, db.senses], async () => {
    const bank = await db.word_bank.where('lemma_norm').anyOf(keys).toArray();
    const lexicon = await db.lexicon_cache.where('lemma_norm').anyOf(keys).toArray();
    const notes = await db.notes.where('term_norm').anyOf(keys).toArray();
    const out: SynonymEntry[] = [];
    for (const w of bank) out.push({ lemma: w.lemma, pos: w.pos, meanings: w.senses.map((s) => s.meaning_tr) });
    for (const l of lexicon) out.push({ lemma: l.lemma, pos: l.pos, meanings: [l.meaning_tr] });
    for (const n of notes) {
      if (n.deleted_at !== null) continue;
      const senses = await db.senses.where('note_id').equals(n.id).toArray();
      for (const s of senses) {
        if (s.deleted_at !== null) continue;
        out.push({ lemma: n.term, pos: s.pos, meanings: [s.meaning_tr_override ?? s.meaning_tr, s.meaning_tr] });
      }
    }
    return out;
  });
}

/** Words the user may have meant instead of `target.term`; [] when none (or on any error). */
export async function findSynonyms(typed: string, target: SynonymTarget): Promise<string[]> {
  try {
    return acceptedSynonyms(await synonymEntries(typed), target);
  } catch {
    return [];
  }
}
