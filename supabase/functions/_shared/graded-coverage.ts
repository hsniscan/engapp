// Coverage of a graded text against the word lists (decision 0047, plan A.5): which share of
// its running words sits at or below each CEFR level. Run by the graded job (Node) on every
// answer before the checker model sees it; the result is stored with the text
// (coverage_by_level, cov_level, cov_next, lemma_profile), and the app measures the same
// lemma profile against what the user knows (src/domain/coverage.ts measureCoverage).
//
// Data: data/levels/client-levels.tsv (CEFR-J 1.5, Octanove C1/C2, wordfreq; the file the app
// uses for levels offline). Rule per running word, the same as the level rule for the words
// of an expression (level.ts): the easiest list level of the word or of one of its base forms
// (went → go), else the frequency band of its Zipf value, else (a plain word rarer than the
// data covers) just below the data's lowest Zipf. Function words are A1. Numbers and
// punctuation are not words; proper nouns (a capitalised word inside a sentence, or a
// capitalised sentence opener the data does not know) are left out.
//
// The gate (plan): ≥ 95 % of the counted tokens at or below the text's level, ≤ 3 % at
// level + 1, and nothing above level + 2 unless the text glosses it.

import { CEFR, levelRank, type Cefr } from './cefr.ts';
import { listLevel, zipfBand, type RefEntry, type WordRefs } from './level.ts';
import { FUNCTION_WORDS, lemmaForms, tokenize } from './tokenize.ts';
import { normalizeLemma } from './text.ts';

export const COVERAGE_MIN_AT_LEVEL = 0.95;
export const COVERAGE_MAX_NEXT = 0.03;

/** The level file, parsed for the checker. */
export interface LevelTable {
  get(lemma: string): WordRefs | undefined;
  /** The data holds every word at or above this Zipf value (null: unknown). */
  minZipf: number | null;
}

const POS: Record<string, string> = {
  n: 'noun',
  v: 'verb',
  j: 'adjective',
  r: 'adverb',
  p: 'preposition',
  c: 'conjunction',
  o: 'pronoun',
  d: 'determiner',
  i: 'interjection',
  x: 'other',
};

const asCefr = (s: string | undefined): Cefr | null =>
  s && (CEFR as readonly string[]).includes(s) ? (s as Cefr) : null;

/**
 * Parses data/levels/client-levels.tsv ("lemma \t zipf \t entries", entries "pos:cefr:src[:
 * cefr_tr:reason]"), the same format src/domain/level.ts parseClientLevels reads.
 */
export function parseLevelTable(text: string): LevelTable {
  const map = new Map<string, WordRefs>();
  let minZipf: number | null = null;
  for (const line of text.split('\n')) {
    if (!line) continue;
    if (line.startsWith('#')) {
      const m = /^# @min_zipf ([\d.]+)/.exec(line);
      if (m) minZipf = Number(m[1]);
      continue;
    }
    const [lemma, z, entries] = line.split('\t');
    if (!lemma) continue;
    const refs: RefEntry[] = [];
    for (const e of entries ? entries.split('|') : []) {
      const [p, cefr, src, trCefr] = e.split(':');
      const level = asCefr(cefr);
      const pos = POS[p ?? ''];
      if (!level || !pos || (src !== 'j' && src !== 'o')) continue;
      refs.push({ pos, cefr: level, source: src === 'j' ? 'cefrj' : 'octanove', tr_cefr: asCefr(trCefr) });
    }
    const zipf = z ? Number(z) : NaN;
    map.set(lemma, { refs, zipf: Number.isFinite(zipf) ? zipf : null });
  }
  return { get: (l) => map.get(l), minZipf };
}

/** A tiny table for tests: lemma → [level or null, zipf or null]. */
export function levelTableOf(
  rows: Record<string, [Cefr | null, number | null]>,
  minZipf: number | null = 3,
): LevelTable {
  const map = new Map<string, WordRefs>();
  for (const [lemma, [cefr, zipf]] of Object.entries(rows))
    map.set(lemma, { refs: cefr ? [{ pos: 'noun', cefr, source: 'cefrj' }] : [], zipf });
  return { get: (l) => map.get(l), minZipf };
}

export interface WordLevelHit {
  /** Dictionary form counted in the profile. */
  lemma: string;
  cefr: Cefr;
}

// Contractions: the base word is counted ("don't" → do, "it's" → it, "won't" → will).
const CONTRACTION_BASE: Record<string, string> = { "won't": 'will', "can't": 'can', "shan't": 'shall', "ain't": 'be' };
const CONTRACTION = /^(.+?)(n't|'s|'re|'ve|'ll|'d|'m|')$/;

function baseOfContraction(norm: string): string {
  const fixed = CONTRACTION_BASE[norm];
  if (fixed) return fixed;
  const m = CONTRACTION.exec(norm);
  return m && m[1] ? m[1] : norm;
}

/** Level and counted lemma of one lower-case word (null: the data cannot place it). */
export function wordLevelOf(norm: string, table: LevelTable): WordLevelHit | null {
  const word = baseOfContraction(norm);
  if (FUNCTION_WORDS.has(word)) return { lemma: word, cefr: 'A1' };
  const forms = lemmaForms(word);
  for (const f of forms) {
    const l = listLevel(table.get(f)?.refs, null);
    if (l) return { lemma: f, cefr: l.cefr };
  }
  const own = table.get(word)?.zipf;
  if (typeof own === 'number') return { lemma: word, cefr: zipfBand(own) };
  for (const f of forms) {
    const z = table.get(f)?.zipf;
    if (typeof z === 'number') return { lemma: f, cefr: zipfBand(z) };
  }
  // A hyphenated compound outside the data: its hardest part.
  if (word.includes('-')) {
    let hardest: Cefr | null = null;
    for (const part of word.split('-').filter(Boolean)) {
      const h = wordLevelOf(part, table);
      if (h && (!hardest || levelRank(h.cefr) > levelRank(hardest))) hardest = h.cefr;
    }
    if (hardest) return { lemma: word, cefr: hardest };
  }
  if (table.minZipf !== null && /^[\p{L}']+$/u.test(word))
    return { lemma: word, cefr: zipfBand(table.minZipf - 0.01) };
  return null;
}

export interface TextProfile {
  /** Counted running words per lemma (no numbers, punctuation or proper nouns). */
  lemmaCounts: Map<string, number>;
  /** Level of each counted lemma. */
  lemmaLevel: Map<string, Cefr>;
  /** Counted tokens. */
  tokens: number;
  /** All running words (also proper nouns), for the length check and the catalogue. */
  words: number;
  /** Proper nouns left out (lower case, unique). */
  properNouns: string[];
}

const isCapitalised = (s: string) => /^\p{Lu}/u.test(s);

/** A capital that a sentence (or quoted speech inside it) starts with. */
function startsClause(sentence: string, index: number, i: number): boolean {
  if (i === 0) return true;
  const before = sentence.slice(0, index).trimEnd();
  return before === '' || /[.!?:;"“‘(]$/u.test(before);
}

/** The lists give the word a level (days, months and common words that are also names). */
function listed(norm: string, table: LevelTable): boolean {
  const word = baseOfContraction(norm);
  return FUNCTION_WORDS.has(word) || lemmaForms(word).some((f) => (table.get(f)?.refs.length ?? 0) > 0);
}

/** Profiles a text given as its sentences. */
export function profileSentences(sentences: readonly string[], table: LevelTable): TextProfile {
  const tokenized = sentences.map((s) => tokenize(s));
  // A word written with a capital inside a sentence anywhere in the text is a name, unless
  // the lists know it (Saturday, English, May).
  const namesInside = new Set<string>();
  tokenized.forEach((toks, k) =>
    toks.forEach((t, i) => {
      if (!isCapitalised(t.text) || startsClause(sentences[k]!, t.index, i)) return;
      if (t.norm === 'i' || t.norm.startsWith("i'") || listed(t.norm, table)) return;
      namesInside.add(t.norm);
    }),
  );
  const lemmaCounts = new Map<string, number>();
  const lemmaLevel = new Map<string, Cefr>();
  const proper = new Set<string>();
  let tokens = 0;
  let words = 0;
  for (const [k, toks] of tokenized.entries()) {
    toks.forEach((t, i) => {
      words++;
      const norm = normalizeLemma(t.text);
      const name =
        isCapitalised(t.text) &&
        (namesInside.has(norm) || (startsClause(sentences[k]!, t.index, i) && !knownToData(norm, table)));
      const hit = name ? null : wordLevelOf(norm, table);
      if (!hit) {
        proper.add(norm);
        return;
      }
      tokens++;
      lemmaCounts.set(hit.lemma, (lemmaCounts.get(hit.lemma) ?? 0) + 1);
      lemmaLevel.set(hit.lemma, hit.cefr);
    });
  }
  return { lemmaCounts, lemmaLevel, tokens, words, properNouns: [...proper].sort() };
}

/** The data has the word or one of its base forms (so a capitalised opener is a real word). */
function knownToData(norm: string, table: LevelTable): boolean {
  const word = baseOfContraction(norm);
  if (FUNCTION_WORDS.has(word)) return true;
  return lemmaForms(word).some((f) => table.get(f) !== undefined);
}

export interface CoverageReport {
  ok: boolean;
  level: Cefr;
  tokens: number;
  words: number;
  /** Share of counted tokens at or below each level. */
  byLevel: Record<Cefr, number>;
  /** Share at or below the text's level. */
  covLevel: number;
  /** Share exactly at level + 1. */
  covNext: number;
  /** Lemmas above level + 2 that are not glossed (must be empty). */
  aboveUnglossed: string[];
  /** Lemmas above the level, most frequent first: what a rewrite should avoid. */
  offenders: string[];
  /** Why the gate failed: 'at_level', 'next_level', 'above'. */
  problems: string[];
}

const round4 = (x: number) => Math.round(x * 10_000) / 10_000;

/** The gate for a text of `level`. `glossed`: words the text explains (any form). */
export function checkCoverage(
  profile: TextProfile,
  level: Cefr,
  glossed: ReadonlySet<string> = new Set(),
): CoverageReport {
  const rank = levelRank(level);
  const atOrBelow = new Array<number>(CEFR.length).fill(0);
  let next = 0;
  const above: string[] = [];
  const offenders: { lemma: string; n: number }[] = [];
  const glossedLemmas = new Set<string>();
  for (const g of glossed) for (const f of lemmaForms(normalizeLemma(g))) glossedLemmas.add(f);
  for (const [lemma, n] of profile.lemmaCounts) {
    const r = levelRank(profile.lemmaLevel.get(lemma) ?? 'C2');
    for (let k = r; k < CEFR.length; k++) atOrBelow[k]! += n;
    if (r === rank + 1) next += n;
    if (r > rank) offenders.push({ lemma, n });
    if (r > rank + 2 && !glossedLemmas.has(lemma)) above.push(lemma);
  }
  const t = profile.tokens;
  const byLevel = Object.fromEntries(
    CEFR.map((c, i) => [c, t === 0 ? 1 : round4(atOrBelow[i]! / t)]),
  ) as Record<Cefr, number>;
  const covLevel = byLevel[level];
  const covNext = t === 0 ? 0 : round4(next / t);
  const problems: string[] = [];
  if (covLevel < COVERAGE_MIN_AT_LEVEL) problems.push('at_level');
  if (covNext > COVERAGE_MAX_NEXT) problems.push('next_level');
  if (above.length > 0) problems.push('above');
  offenders.sort((a, b) => b.n - a.n || a.lemma.localeCompare(b.lemma));
  return {
    ok: problems.length === 0 && t > 0,
    level,
    tokens: t,
    words: profile.words,
    byLevel,
    covLevel,
    covNext,
    aboveUnglossed: above.sort(),
    offenders: offenders.map((o) => o.lemma),
    problems: t > 0 ? problems : ['empty'],
  };
}

/** The lemma profile as stored (plain object, keys sorted for stable rows). */
export function profileObject(profile: TextProfile): Record<string, number> {
  return Object.fromEntries([...profile.lemmaCounts].sort(([a], [b]) => a.localeCompare(b)));
}
