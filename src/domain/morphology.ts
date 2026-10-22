// Word families, roots and affixes (İP6). Pure: the shape of the static morphology file
// (public/data/morphology-<sha>.json, built by scripts/build-morphology), lookups by term and
// the root/affix card suggestion rule.
import { normalizeTerm } from './normalize';

export type MorphemeKind = 'prefix' | 'suffix' | 'root';

export interface MorphemeEntry {
  /** "re-", "-ness", "spect". */
  id: string;
  /** Display form: "re-", "-ness", "-spect-". */
  form: string;
  kind: MorphemeKind;
  origin: 'latin' | 'greek' | 'germanic' | 'french';
  gloss_en: string;
  /** Hand-written short Turkish meaning (shown until the AI explanation exists). */
  tr: string;
  /** How many words of the 30k vocabulary carry it. */
  words: number;
  ai: {
    meaning_tr: string;
    note_tr: string | null;
    model: string;
    prompt_version: string;
    reviewed: boolean;
  } | null;
}

/** The JSON file as built. */
export interface MorphologyFile {
  format: 1;
  license: string;
  notice: string;
  morphemes: MorphemeEntry[];
  /** Each family: base word first, then by frequency. */
  families: string[][];
  /** [lemma, part of speech or '', family index or -1, morpheme indexes]. */
  words: [string, string, number, number[]][];
}

export interface WordInfo {
  lemma: string;
  pos: string | null;
  family: number;
  morphemes: MorphemeEntry[];
}

export interface MorphologyIndex {
  file: MorphologyFile;
  byLemma: Map<string, WordInfo>;
  /** By id and by display form ("spect", "-spect-"), for affix notes. */
  morphemeByKey: Map<string, MorphemeEntry>;
}

export function indexMorphology(file: MorphologyFile): MorphologyIndex {
  const byLemma = new Map<string, WordInfo>();
  for (const [lemma, pos, family, ms] of file.words) {
    byLemma.set(lemma, {
      lemma,
      pos: pos || null,
      family,
      morphemes: ms.map((i) => file.morphemes[i]).filter((m): m is MorphemeEntry => !!m),
    });
  }
  const morphemeByKey = new Map<string, MorphemeEntry>();
  for (const m of file.morphemes) {
    morphemeByKey.set(m.id, m);
    morphemeByKey.set(normalizeTerm(m.form), m);
  }
  return { file, byLemma, morphemeByKey };
}

/**
 * The file's entry for a term. Notes hold dictionary forms, so an exact match is the rule;
 * a plain inflection the user saved anyway ("decisions", "inspected") falls back to its lemma.
 */
export function wordInfo(index: MorphologyIndex, term: string): WordInfo | null {
  const norm = normalizeTerm(term);
  if (!/^[a-z]+$/.test(norm)) return null;
  const direct = index.byLemma.get(norm);
  if (direct) return direct;
  const candidates: string[] = [];
  if (norm.endsWith('ies')) candidates.push(`${norm.slice(0, -3)}y`);
  if (norm.endsWith('es')) candidates.push(norm.slice(0, -2));
  if (norm.endsWith('s') && !norm.endsWith('ss')) candidates.push(norm.slice(0, -1));
  if (norm.endsWith('ed')) candidates.push(norm.slice(0, -2), norm.slice(0, -1));
  if (norm.endsWith('ing')) candidates.push(norm.slice(0, -3), `${norm.slice(0, -3)}e`);
  for (const c of candidates) {
    const hit = index.byLemma.get(c);
    if (hit) return hit;
  }
  return null;
}

export interface FamilyMember {
  lemma: string;
  pos: string | null;
  /** The user has a live note for it. */
  carded: boolean;
  /** The term itself. */
  self: boolean;
}

/**
 * The word family of a term (base first, then by frequency), each member marked when the
 * user already has it. `null` when the term has no family.
 */
export function familyOf(
  index: MorphologyIndex,
  term: string,
  userTerms: ReadonlySet<string>,
): { base: string; members: FamilyMember[] } | null {
  const info = wordInfo(index, term);
  if (!info || info.family < 0) return null;
  const family = index.file.families[info.family];
  if (!family || family.length < 2) return null;
  return {
    base: family[0]!,
    members: family.map((lemma) => ({
      lemma,
      pos: index.byLemma.get(lemma)?.pos ?? null,
      carded: userTerms.has(lemma) || lemma === info.lemma,
      self: lemma === info.lemma,
    })),
  };
}

/** The Turkish meaning to show for a morpheme: AI explanation, else the hand-written one. */
export function morphemeMeaning(m: MorphemeEntry): { meaning: string; note: string | null; source: 'ai' | 'curated' } {
  if (m.ai?.meaning_tr.trim()) return { meaning: m.ai.meaning_tr, note: m.ai.note_tr, source: 'ai' };
  return { meaning: m.tr, note: null, source: 'curated' };
}

/** A user's word with the lemma the file knows it by. */
export interface UserWord {
  term: string;
  term_norm: string;
}

/** The user's words that carry a morpheme, in the order given. */
export function wordsWithMorpheme(index: MorphologyIndex, morphemeId: string, words: readonly UserWord[]): UserWord[] {
  return words.filter((w) => wordInfo(index, w.term_norm)?.morphemes.some((m) => m.id === morphemeId));
}

export const MIN_WORDS_FOR_MORPHEME_CARD = 3;

export interface MorphemeSuggestion {
  morpheme: MorphemeEntry;
  /** The user's words that carry it (at least MIN_WORDS_FOR_MORPHEME_CARD). */
  words: UserWord[];
}

/**
 * Root/affix cards worth suggesting for a term: its morphemes that at least three of the
 * user's words carry, that the user has no card for yet and has not dismissed. Roots come
 * first (they carry the most meaning), then prefixes, then suffixes; within a kind, the
 * morpheme in more of the user's words first.
 */
export function morphemeSuggestions(
  index: MorphologyIndex,
  term: string,
  userWords: readonly UserWord[],
  opts: { carded: ReadonlySet<string>; dismissed: ReadonlySet<string> },
): MorphemeSuggestion[] {
  const info = wordInfo(index, term);
  if (!info) return [];
  const order: Record<MorphemeKind, number> = { root: 0, prefix: 1, suffix: 2 };
  return info.morphemes
    .filter((m) => !opts.dismissed.has(m.id) && !opts.carded.has(m.id))
    .map((m) => ({ morpheme: m, words: wordsWithMorpheme(index, m.id, userWords) }))
    .filter((s) => s.words.length >= MIN_WORDS_FOR_MORPHEME_CARD)
    .sort(
      (a, b) =>
        order[a.morpheme.kind] - order[b.morpheme.kind] ||
        b.words.length - a.words.length ||
        a.morpheme.id.localeCompare(b.morpheme.id),
    );
}

/** The morpheme an affix note stands for ("-spect-" → spect), if the file knows it. */
export function morphemeOfNote(index: MorphologyIndex, termNorm: string): MorphemeEntry | null {
  return index.morphemeByKey.get(normalizeTerm(termNorm)) ?? null;
}

/** Ids of the morphemes the user already has an affix note for. */
export function cardedMorphemes(index: MorphologyIndex, affixTerms: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const t of affixTerms) {
    const m = morphemeOfNote(index, t);
    if (m) out.add(m.id);
  }
  return out;
}
