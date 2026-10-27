// What the reader shows for each word (v0.5 İP1, decision 0043). Pure.
//
// Colours follow the plan's rule "bildiklerin sade, öğrendiklerin hafif işaretli, yeniler
// belirgin": a word the user most likely does not know and has no card for is "new"; the
// user's own words show their stage until they are learned; everything else stays plain.
// The user's multi-word cards ("give up", "in charge of") are found in the text too, with the
// first word in any of its forms ("gave up").
import { lemmaForms } from '../../supabase/functions/_shared/tokenize';
import { measureCoverage } from './coverage';
import type { KnowledgeModel } from './knowledgeModel';
import { lemmaCounts, type ReaderToken, type TokenizedText } from './readerTokens';
import type { WordStage } from './stages';
import type { CoverageResult } from './texts';

/** How a word is drawn. 'plain' = no mark (known, learned, a name, a number). */
export type WordMark = 'new' | 'learning' | 'consolidating' | 'plain';

/** Below this the reader marks an unknown word as new. */
export const NEW_MARK_BELOW = 0.5;

export interface PhraseMatch {
  /** Tokens [first, end) of the phrase. */
  first: number;
  end: number;
  /** The user's note term (term_norm). */
  term: string;
}

export interface ReaderView {
  /** Lemma of each token (same order as text.tokens). */
  lemmas: string[];
  /** Mark of each token. */
  marks: WordMark[];
  /** The user's note term each token belongs to (a word or a phrase), or null. */
  noteTerms: (string | null)[];
  phrases: PhraseMatch[];
  coverage: CoverageResult;
  /** term_norm of every user note met in the text (words and phrases), each once. */
  metTerms: string[];
}

/** First word lemma → the rest of each multi-word note ("give" → ["give up", ...]). */
export function phraseIndex(terms: Iterable<string>): Map<string, string[][]> {
  const out = new Map<string, string[][]>();
  for (const term of terms) {
    const words = term.split(' ').filter(Boolean);
    if (words.length < 2 || words.length > 5) continue;
    // Patterns with slots ("take sth for granted") are not looked for in running text.
    if (words.some((w) => /^(sth|sb|someone|something|one's|somebody)$/.test(w))) continue;
    const list = out.get(words[0]!);
    if (list) list.push(words);
    else out.set(words[0]!, [words]);
  }
  for (const list of out.values()) list.sort((a, b) => b.length - a.length);
  return out;
}

/** Multi-word notes in the text: inside one sentence, longest first, no overlaps. */
export function findPhrases(
  tokens: readonly ReaderToken[],
  lemmas: readonly string[],
  index: ReadonlyMap<string, string[][]>,
): PhraseMatch[] {
  if (index.size === 0) return [];
  const out: PhraseMatch[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const firsts = new Set([lemmas[i]!, t.norm, ...lemmaForms(t.norm)]);
    let hit: PhraseMatch | null = null;
    for (const first of firsts) {
      for (const words of index.get(first) ?? []) {
        const end = i + words.length;
        if (end > tokens.length) continue;
        let ok = true;
        for (let k = 1; k < words.length; k++) {
          const u = tokens[i + k]!;
          if (u.sentence !== t.sentence || (u.norm !== words[k] && lemmas[i + k] !== words[k])) {
            ok = false;
            break;
          }
        }
        if (ok && (!hit || end - i > hit.end - hit.first))
          hit = { first: i, end, term: words.join(' ') };
      }
    }
    if (hit) {
      out.push(hit);
      i = hit.end - 1;
    }
  }
  return out;
}

export function markOf(stage: WordStage | null, p: number, counted: boolean): WordMark {
  if (stage === 'new' || stage === 'learning') return 'learning';
  if (stage === 'consolidating') return 'consolidating';
  if (stage) return 'plain';
  return counted && p < NEW_MARK_BELOW ? 'new' : 'plain';
}

/** Everything the reader draws, computed once per text and knowledge change. */
export function buildReaderView(
  text: TokenizedText,
  k: KnowledgeModel,
  noteTerms: Iterable<string>,
): ReaderView {
  const { tokens } = text;
  const lemmas = tokens.map((t) => k.lemmatize(t.norm));
  const marks: WordMark[] = new Array<WordMark>(tokens.length);
  const terms: (string | null)[] = new Array<string | null>(tokens.length).fill(null);
  const met = new Set<string>();
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const lemma = lemmas[i]!;
    const stage = t.proper ? null : k.stage(lemma);
    if (stage) {
      terms[i] = lemma;
      met.add(lemma);
    }
    marks[i] =
      t.proper || !/\p{L}/u.test(t.text) ? 'plain' : markOf(stage, k.pKnown(lemma), t.counted);
  }
  const phrases = findPhrases(tokens, lemmas, phraseIndex(noteTerms));
  for (const ph of phrases) {
    const stage = k.stage(ph.term);
    met.add(ph.term);
    for (let i = ph.first; i < ph.end; i++) {
      terms[i] = ph.term;
      marks[i] = markOf(stage, 1, true);
    }
  }
  const coverage = measureCoverage(
    lemmaCounts(tokens, (n) => k.lemmatize(n)),
    k.pKnown,
  );
  return { lemmas, marks, noteTerms: terms, phrases, coverage, metTerms: [...met] };
}

/** "Bu metnin %96'sını biliyorsun": the known share, rounded down so it never flatters. */
export function knownPercent(c: CoverageResult): number {
  if (c.tokens === 0) return 100;
  return Math.max(0, Math.min(100, Math.floor((1 - c.unknownRate) * 100 + 1e-9)));
}

/** A word the reader marked as new, at its first place in the text. */
export interface NewWord {
  /** Dictionary form (the card's term). */
  lemma: string;
  /** As first written in the text. */
  written: string;
  /** Index of the sentence it first appears in. */
  sentence: number;
}

/**
 * The words drawn as new ("Muhtemelen yeni"), each once, in reading order (v0.5.1 end-of-text
 * summary "Bu metinde N yeni kelime gördün" and "Bu metindeki yeni kelimeler").
 */
export function newWordsIn(
  text: TokenizedText,
  view: Pick<ReaderView, 'marks' | 'lemmas'>,
): NewWord[] {
  const out: NewWord[] = [];
  const seen = new Set<string>();
  text.tokens.forEach((t, i) => {
    if (view.marks[i] !== 'new') return;
    const lemma = view.lemmas[i] ?? t.norm;
    if (!lemma || seen.has(lemma)) return;
    seen.add(lemma);
    out.push({ lemma, written: t.text, sentence: t.sentence });
  });
  return out;
}
