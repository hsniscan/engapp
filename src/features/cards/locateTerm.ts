import { findGappedSpan, findSpan } from '../../../supabase/functions/_shared/locate';

export type Span = [number, number];

/**
 * Loose "same word" test for inflected forms the user typed in an example sentence:
 * bank → banks, give → giving, run → running, study → studied. Irregular forms
 * (give → gave) are not guessed; the preview then says the term was not found.
 */
function sameWordLoose(sentenceWord: string, termWord: string): boolean {
  if (sentenceWord === termWord) return true;
  if (termWord.length < 3) return false;
  const stem = termWord.replace(/(e|y)$/u, '');
  return sentenceWord.startsWith(stem) && sentenceWord.length - termWord.length <= 4;
}

/**
 * Where the term occurs in the example sentence, as [start, end). Tries the exact form,
 * then case/typography-insensitive, then separable phrasal verbs ("turned it down"),
 * then simple inflections. Null when the term cannot be found.
 */
export function locateTerm(sentence: string, term: string): Span | null {
  const s = sentence;
  const t = term.trim();
  if (!s.trim() || !t) return null;
  return findSpan(s, t) ?? findGappedSpan(s, t, 4, sameWordLoose);
}
