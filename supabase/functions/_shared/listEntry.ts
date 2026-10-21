// Vocabulary lists put the entry number and the headword in front of the example sentence
// ("1988 trailer I own a trailer."). PDF text has no break between them, so the sentence the
// model quotes carries the prefix along; this cuts it off. Pure: shared by ai-extract and the
// client repair of already saved senses.

const ENTRY_NUMBER = /^\s*\d{1,5}[.)]?\s+/;
const AFTER_HEADWORD = /^[.!?…]*\s+/;

/**
 * `sentence` without a leading "<number> <term>" list prefix. Only when the rest still holds
 * the term, so prose that merely starts with a number ("3 people came") stays as it is.
 */
export function stripListEntryPrefix(sentence: string, term: string): string {
  const num = ENTRY_NUMBER.exec(sentence);
  const head = term.trim();
  if (!num || !head) return sentence;
  const rest = sentence.slice(num[0].length);
  if (!rest.toLocaleLowerCase('en').startsWith(head.toLocaleLowerCase('en'))) return sentence;
  const after = rest.slice(head.length);
  const gap = AFTER_HEADWORD.exec(after);
  if (!gap) return sentence;
  const example = after.slice(gap[0].length).trim();
  return example && containsTerm(example, head) ? example : sentence;
}

/** The term, or its stem for an inflected use ("today" in "today's homework", "decide" in "decided"). */
function containsTerm(text: string, term: string): boolean {
  const t = text.toLocaleLowerCase('en');
  const h = term.toLocaleLowerCase('en');
  if (t.includes(h)) return true;
  const first = h.split(/\s+/)[0] ?? h;
  return first.length >= 4 && t.includes(first.slice(0, Math.max(3, first.length - 2)));
}

/**
 * For sentences saved before the prefix was cut (cached AI results, existing senses): the
 * clean sentence and the span moved into it. A span that pointed at the headword is found
 * again in the example; null when the surface is not in it.
 */
export function stripListEntry(
  sentence: string,
  term: string,
  span: [number, number] | null,
): { sentence: string; span: [number, number] | null } {
  const clean = stripListEntryPrefix(sentence, term);
  if (clean === sentence) return { sentence, span };
  const offset = sentence.lastIndexOf(clean);
  if (span && offset >= 0 && span[0] >= offset) {
    return { sentence: clean, span: [span[0] - offset, span[1] - offset] };
  }
  const surface = span ? sentence.slice(span[0], span[1]) : term;
  const at = clean.toLocaleLowerCase('en').indexOf(surface.toLocaleLowerCase('en'));
  return { sentence: clean, span: at >= 0 ? [at, at + surface.length] : null };
}
