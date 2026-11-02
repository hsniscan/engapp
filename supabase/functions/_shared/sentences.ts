// Sentence helpers shared by the text AI tasks (mnemonics, contrast cards, the weekly report,
// the daily story): cleaning, word counts, duplicate keys and locating a term in a sentence.
// They came from the ai-examples pipeline, removed in v0.5.2 (ADR 0061).

import { termMatchesSurface } from './extract.ts';
import { findGappedSpan, findSpan } from './locate.ts';
import { isCleanLexiconText } from './text.ts';
import { FUNCTION_WORDS, lemmaForms, tokenize } from './tokenize.ts';

const INVISIBLE_G = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}]/gu;
// Sentences: Latin letters, digits and ordinary punctuation (no other scripts, no markup).
const SENTENCE_TEXT = /^[\p{Script=Latin}\p{M}\p{N} '’",;:.()\-/!?&%$£€]+$/u;

/** Whitespace collapsed, invisible characters and wrapping quotes removed. */
export function cleanExampleText(s: string): string {
  return s
    .replace(INVISIBLE_G, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["“”‘’']+|["“”‘’']+$/g, '')
    .trim();
}

/** Words of a sentence (tokens with a letter or digit). */
export function wordCount(s: string): number {
  return s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** Duplicate key of a sentence; the SQL twin is lexicon_examples.text_key. */
export function exampleTextKey(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Same sentence, or the same words in another order / with one or two words changed. */
export function isNearDuplicateSentence(a: string, b: string): boolean {
  const ka = exampleTextKey(a);
  const kb = exampleTextKey(b);
  if (ka === kb) return true;
  const ta = new Set(ka.split(' '));
  const tb = new Set(kb.split(' '));
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union > 0 && inter / union >= 0.7;
}

/** Fit for a shared sentence (English or Turkish): no links, markup or foreign scripts. */
export function isCleanSentence(s: string): boolean {
  return isCleanLexiconText(s, 'ipa') && SENTENCE_TEXT.test(s) && /\p{L}/u.test(s);
}

const PLACEHOLDER = /^(?:sb|sth|smb|smth|someone|somebody|something|one's|oneself|someone's|somebody's|sb's|doing)$/;

/**
 * [start, end) of the term in the sentence. The model's `surface` is used when it is a form
 * of the term and occurs in the sentence; otherwise the term's own words are searched (any
 * inflection, up to four words in between, slots like "sth" skipped). Null: the sentence
 * does not contain the term.
 */
export function locateExampleTerm(
  text: string,
  lemma: string,
  surface: string,
): [number, number] | null {
  const surf = surface.trim();
  if (surf && termMatchesSurface(lemma, surf)) {
    const at = findSpan(text, surf);
    if (at) return at;
  }
  const words = tokenize(lemma)
    .map((t) => t.norm)
    .filter((w) => !PLACEHOLDER.test(w));
  if (words.length === 0) return null;
  const same = (sentenceWord: string, termWord: string) =>
    sentenceWord === termWord || lemmaForms(sentenceWord).includes(termWord);
  if (words.length === 1) {
    for (const t of tokenize(text)) {
      if (same(t.norm, words[0]!)) return [t.index, t.index + t.text.length];
    }
    return null;
  }
  // A multi-word term made only of function words would match almost anything loosely.
  if (words.every((w) => FUNCTION_WORDS.has(w))) return findSpan(text, words.join(' '));
  return findGappedSpan(text, words.join(' '), 4, same);
}
