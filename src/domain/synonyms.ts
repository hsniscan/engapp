// Accepted synonyms for typed answers (v0.5 İP9, ADR 0051). Pure. A typed English word is an
// accepted synonym of the card's term when the dictionary data on the device (the Kelime
// Bankası word list, the cached shared lexicon and the user's own words) gives it a Turkish
// meaning that shares a whole alternative with the card's meaning ("büyük" ~ "büyük, iri"),
// with a compatible part of speech. The data layer (data/synonyms.ts) finds the entries.
import { isSameMeaningTr } from '../../supabase/functions/_shared/text';
import { foldAnswer } from './answerCheck';

export interface SynonymEntry {
  /** The English word or phrase. */
  lemma: string;
  pos: string | null;
  /** Its Turkish meanings (each may list alternatives: "büyük, iri"). */
  meanings: readonly string[];
}

export interface SynonymTarget {
  term: string;
  pos: string | null;
  /** The card's Turkish meaning (the user's override first). */
  meaning: string | null;
}

const VERBISH = new Set(['verb', 'phrasal verb']);
const PHRASEISH = new Set(['phrase', 'idiom', 'phrasal verb']);

/** Parts of speech that may stand for each other: unknown or 'other' fits anything. */
export function posCompatible(a: string | null, b: string | null): boolean {
  if (!a || !b || a === 'other' || b === 'other' || a === b) return true;
  return (VERBISH.has(a) && VERBISH.has(b)) || (PHRASEISH.has(a) && PHRASEISH.has(b));
}

/** The entries' lemmas that mean the same as the target (never the target itself). */
export function acceptedSynonyms(entries: readonly SynonymEntry[], target: SynonymTarget): string[] {
  if (!target.meaning?.trim()) return [];
  const self = foldAnswer(target.term);
  const out = new Set<string>();
  for (const e of entries) {
    if (foldAnswer(e.lemma) === self || !posCompatible(e.pos, target.pos)) continue;
    if (e.meanings.some((m) => isSameMeaningTr(m, target.meaning))) out.add(e.lemma);
  }
  return [...out];
}
