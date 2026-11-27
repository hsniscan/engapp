// Text normalisation shared by the edge functions (Deno) and the web client tests (Node).
// Pure TypeScript: no Deno or DOM globals, no imports.

const APOSTROPHES = /[‘’‚‛ʼʹ′`´＇]/g;
const QUOTES = /[“”„‟″«»＂]/g;
const DASHES = /[‐‑‒–—−]/g;

/**
 * lexicon_terms.lemma_norm. Identical to normalizeTerm() in src/domain/normalize.ts
 * (notes.term_norm), so a note and its lexicon term compare equal. A vitest test keeps
 * the two in step.
 */
export function normalizeLemma(input: string): string {
  return input
    .normalize('NFC')
    .replace(APOSTROPHES, "'")
    .replace(QUOTES, '"')
    .replace(DASHES, '-')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();
}

/** Display form of a lemma from the model: trimmed, typographic marks folded, no edge punctuation. */
export function cleanLemma(input: string): string {
  return input
    .normalize('NFC')
    .replace(APOSTROPHES, "'")
    .replace(DASHES, '-')
    .replace(/\s+/gu, ' ')
    .replace(/^[\s"'.,;:!?()[\]{}]+|[\s".,;:!?()[\]{}]+$/gu, '')
    .trim();
}

// ---------------------------------------------------------------------------
// Part of speech
// ---------------------------------------------------------------------------

export const POS_VALUES = [
  'noun',
  'verb',
  'adjective',
  'adverb',
  'phrasal verb',
  'idiom',
  'phrase',
  'preposition',
  'conjunction',
  'pronoun',
  'determiner',
  'interjection',
  'other',
] as const;
export type Pos = (typeof POS_VALUES)[number];

const POS_ALIASES: Record<string, Pos> = {
  n: 'noun',
  'noun phrase': 'phrase',
  'proper noun': 'noun',
  v: 'verb',
  'modal verb': 'verb',
  'auxiliary verb': 'verb',
  auxiliary: 'verb',
  modal: 'verb',
  adj: 'adjective',
  adv: 'adverb',
  'phrasal-verb': 'phrasal verb',
  phrasal_verb: 'phrasal verb',
  phrasalverb: 'phrasal verb',
  'idiomatic expression': 'idiom',
  expression: 'phrase',
  'fixed expression': 'phrase',
  collocation: 'phrase',
  'set phrase': 'phrase',
  'prepositional phrase': 'phrase',
  'verb phrase': 'phrase',
  pattern: 'phrase',
  prep: 'preposition',
  conj: 'conjunction',
  pron: 'pronoun',
  article: 'determiner',
  quantifier: 'determiner',
  det: 'determiner',
  interj: 'interjection',
  exclamation: 'interjection',
};

export function normalizePos(raw: string | null | undefined): Pos | null {
  if (!raw) return null;
  const s = raw.toLowerCase().replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim();
  if ((POS_VALUES as readonly string[]).includes(s)) return s as Pos;
  return POS_ALIASES[s] ?? (s ? 'other' : null);
}

// ---------------------------------------------------------------------------
// gloss_key: dedup key of an English sense gloss
// ---------------------------------------------------------------------------

const GLOSS_STOP = new Set([
  'a',
  'an',
  'the',
  'to',
  'of',
  'or',
  'and',
  'in',
  'on',
  'at',
  'for',
  'with',
  'by',
  'from',
  'as',
  'be',
  'is',
  'are',
  'was',
  'that',
  'which',
  'who',
  'whom',
  'whose',
  'its',
  'it',
  'this',
  'these',
  'those',
  'into',
  'about',
  'very',
  'so',
  'such',
  'etc',
  'eg',
  'ie',
  'usually',
  'especially',
  'often',
  'used',
  'when',
  'something',
  'someone',
  'somebody',
  'sth',
  'sb',
  'one',
  'ones',
  'your',
  'their',
  'his',
  'her',
  'not',
]);

/** Tokens of a gloss after folding: ASCII lower-case words, stop words removed, light stemming. */
export function glossTokens(gloss: string): string[] {
  const words = gloss
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(APOSTROPHES, "'")
    .toLowerCase()
    .replace(/'s\b/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0 && !(w.length === 1 && /[a-z]/.test(w)));
  const content = words.filter((w) => !GLOSS_STOP.has(w));
  const chosen = content.length > 0 ? content : words;
  return [...new Set(chosen.map(stemGlossWord))];
}

function stemGlossWord(w: string): string {
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 4 && /(ches|shes|sses|xes|zes)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}

/**
 * lexicon_senses.gloss_key: sorted unique gloss tokens joined by one space.
 * "the land beside a river" and "Land beside rivers." -> "beside land river".
 * Matches the CHECK constraint ^[a-z0-9]+( [a-z0-9]+)*$, at most 200 chars.
 * Returns null when the gloss has no usable token.
 */
export function glossKey(gloss: string): string | null {
  const tokens = glossTokens(gloss).sort();
  if (tokens.length === 0) return null;
  let key = '';
  for (const t of tokens) {
    const next = key ? `${key} ${t}` : t;
    if (next.length > 200) break;
    key = next;
  }
  return key || null;
}

/** Jaccard similarity of two glosses' token sets (0..1). */
export function glossSimilarity(a: string, b: string): number {
  const ta = new Set(glossTokens(a));
  const tb = new Set(glossTokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

/**
 * Same sense, worded differently? True when the token sets are nearly equal
 * (Jaccard >= 0.8) or one set of at least 3 tokens contains the other.
 * Only applied between senses of the same term and part of speech.
 */
export function isNearDuplicateGloss(a: string, b: string): boolean {
  const ta = new Set(glossTokens(a));
  const tb = new Set(glossTokens(b));
  if (ta.size === 0 || tb.size === 0) return false;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const jaccard = inter / (ta.size + tb.size - inter);
  if (jaccard >= 0.8) return true;
  const smaller = Math.min(ta.size, tb.size);
  return smaller >= 3 && inter === smaller;
}

// ---------------------------------------------------------------------------
// Shared-lexicon content guard
// ---------------------------------------------------------------------------

// Links, e-mail addresses, markup and code-ish characters never belong in a dictionary
// entry; they are what a prompt-injected model would write to reach other users.
const LINKISH =
  /https?:|www\.|:\/\/|@|[<>{}`\\|[\]]|\b[a-z0-9-]{2,}\.(?:com|net|org|io|ru|xyz|info|biz|co|me|app|dev|link|site|top|tr)\b/iu;
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}]/u;
// English glosses: Latin letters, digits, spaces and ordinary punctuation.
const EN_TEXT = /^[\p{Script=Latin}\p{M}\p{N} '’",;:.()\-/!?&]+$/u;
// Turkish meanings: Latin letters (incl. Turkish ones), spaces and light punctuation.
const TR_TEXT = /^[\p{Script=Latin}\p{M} '’,;:.()\-/]+$/u;

/**
 * Is this text fit for the shared lexicon (lemma or gloss_en: 'en'; meaning_tr: 'tr';
 * ipa: 'ipa' — IPA symbols are not limited to Latin script, only links/markup are refused)?
 */
export function isCleanLexiconText(s: string, kind: 'en' | 'tr' | 'ipa'): boolean {
  if (!s || INVISIBLE.test(s.replace(/[‍]/g, '')) || LINKISH.test(s)) return false;
  if (kind === 'en') return EN_TEXT.test(s);
  if (kind === 'tr') return TR_TEXT.test(s);
  return true;
}

// ---------------------------------------------------------------------------
// Turkish meaning overlap: the semantic duplicate guard for senses
// ---------------------------------------------------------------------------

/**
 * The alternatives of a Turkish meaning ("davetiye, davet" -> ["davetiye", "davet"]):
 * split on "," ";" "/", NFC, lower-case with Turkish rules ("İhmal" -> "ihmal", "Işık" ->
 * "ışık"; plain toLowerCase made "İ" an "i" plus a combining dot, review 2026-11-26 #4),
 * whitespace collapsed, edge spaces and periods removed. The SQL twin is
 * public.lexicon_meaning_alts() (migration 20261021001000).
 */
export function meaningAlternatives(meaning: string | null | undefined): string[] {
  if (!meaning) return [];
  const out = meaning
    .normalize('NFC')
    .toLocaleLowerCase('tr')
    .split(/[,;/]/)
    .map((a) => a.replace(/\s+/gu, ' ').replace(/^[ .]+|[ .]+$/g, ''))
    .filter(Boolean);
  return [...new Set(out)];
}

/**
 * Do two Turkish meanings name the same thing? True when they share a whole alternative:
 * "davet" ~ "davetiye, davet", "kıyı" ~ "kıyı, sahil"; not "banka" ~ "kıyı" or
 * "çalışmak" ~ "işlemek". Words inside an alternative are not compared on their own
 * ("nehir kıyısı" is not "deniz kıyısı").
 */
export function isSameMeaningTr(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const ta = meaningAlternatives(a);
  if (ta.length === 0) return false;
  const tb = new Set(meaningAlternatives(b));
  return ta.some((x) => tb.has(x));
}

/**
 * Is one Turkish meaning contained in the other? True when every alternative of one is an
 * alternative of the other: "isteksiz" ~ "isteksiz, gönülsüz", "gelişmek" ~ "gelişmek,
 * büyümek", "İhmal etmek" ~ "ihmal etmek"; not "kıyı, sahil" ~ "kıyı, banka" (they only
 * share a part, which may be two senses of the word).
 */
export function isNestedMeaningTr(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const ta = meaningAlternatives(a);
  const tb = meaningAlternatives(b);
  if (ta.length === 0 || tb.length === 0) return false;
  const [small, big] = ta.length <= tb.length ? [ta, new Set(tb)] : [tb, new Set(ta)];
  return small.every((x) => big.has(x));
}

/**
 * The semantic duplicate rule for two senses of one term. With the same (known) part of
 * speech: an overlapping Turkish meaning. When either has no part of speech (a hand-written
 * or CSV sense): one meaning contains the other (isNestedMeaningTr). Two such senses would
 * make the same flashcard ("davet"), whatever their English glosses say. Free (no model
 * call); applied before a new lexicon sense is inserted and before a sense is added to a
 * user's note. Two different known parts of speech are never duplicates.
 */
export function isDuplicateSense(
  a: { pos?: string | null; meaning_tr: string | null | undefined },
  b: { pos?: string | null; meaning_tr: string | null | undefined },
): boolean {
  if (a.pos && b.pos)
    return a.pos === b.pos && isSameMeaningTr(a.meaning_tr, b.meaning_tr);
  return isNestedMeaningTr(a.meaning_tr, b.meaning_tr);
}
