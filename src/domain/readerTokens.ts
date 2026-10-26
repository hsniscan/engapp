// The reader's tokeniser (v0.5 İP1, decision 0043). Pure.
//
// Splits a ReaderText body into paragraphs (blank lines), sentences and running words, keeping
// every offset so the screen can draw the text as it is and the listen-along mode can mark one
// sentence at a time. Each word says whether it counts for coverage (domain/coverage.ts):
// numbers, single letters, web addresses and capitalised words in the middle of a sentence
// (proper nouns: "Istanbul", "NASA") do not. Punctuation is never a token.
import { normalizeTerm } from './normalize';

export interface ReaderToken {
  /** [start, end) in the body. */
  start: number;
  end: number;
  /** As written. */
  text: string;
  /** Lower case, typographic apostrophes and dashes folded (normalizeTerm). */
  norm: string;
  /** Index into TokenizedText.sentences. */
  sentence: number;
  /** A name, an acronym or a word after which nothing can be inferred (not counted). */
  proper: boolean;
  /** Counted for coverage: not a number, a stray letter, part of an address or a proper noun. */
  counted: boolean;
}

export interface ReaderSentence {
  /** [start, end) in the body, from the first to the last character that is not a space. */
  start: number;
  end: number;
  paragraph: number;
  /** Tokens [firstToken, endToken). */
  firstToken: number;
  endToken: number;
}

export interface ReaderParagraph {
  start: number;
  end: number;
  /** Sentences [firstSentence, endSentence). */
  firstSentence: number;
  endSentence: number;
}

export interface TokenizedText {
  tokens: ReaderToken[];
  sentences: ReaderSentence[];
  paragraphs: ReaderParagraph[];
}

const WORD_RE = /[\p{L}\p{M}\p{N}]+(?:['’‘ʼ\-‐‑][\p{L}\p{M}\p{N}]+)*/gu;
const ADDRESS_RE = /\b(?:https?:\/\/|www\.)[^\s<>"]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+/giu;
const DIGIT_RE = /\p{N}/u;
const UPPER_START_RE = /^\p{Lu}/u;
const HAS_LOWER_RE = /\p{Ll}/u;
const LETTER_RE = /\p{L}/u;

/** Words after which a full stop does not end the sentence. */
const ABBREVIATIONS = new Set([
  'mr',
  'mrs',
  'ms',
  'dr',
  'prof',
  'sr',
  'jr',
  'st',
  'vs',
  'etc',
  'e.g',
  'i.e',
  'no',
  'inc',
  'ltd',
  'co',
  'corp',
  'mt',
  'ft',
  'approx',
  'dept',
  'est',
  'fig',
  'gen',
  'gov',
  'jan',
  'feb',
  'mar',
  'apr',
  'jun',
  'jul',
  'aug',
  'sep',
  'sept',
  'oct',
  'nov',
  'dec',
  'u.s',
  'u.k',
  'a.m',
  'p.m',
]);

/** "I", "I'm", "I've", "I'd", "I'll": capitalised, never a name. */
const isPronounI = (norm: string) => norm === 'i' || /^i['’](m|ve|d|ll)$/.test(norm);

/** Paragraph ranges: text between blank lines, trimmed. */
function paragraphRanges(body: string): [number, number][] {
  const out: [number, number][] = [];
  const re = /\n[ \t]*\n/g;
  let from = 0;
  const push = (a: number, b: number) => {
    let s = a;
    let e = b;
    while (s < e && /\s/.test(body[s]!)) s++;
    while (e > s && /\s/.test(body[e - 1]!)) e--;
    if (e > s) out.push([s, e]);
  };
  for (const m of body.matchAll(re)) {
    push(from, m.index);
    from = m.index + m[0].length;
  }
  push(from, body.length);
  return out;
}

/**
 * Where sentences end inside [start, end): after . ! ? … (and closing quotes/brackets) when
 * a space and an upper-case letter, a digit or an opening quote follow; never after a known
 * abbreviation or a single capital letter (initials: "J. K. Rowling").
 */
function sentenceRanges(body: string, start: number, end: number): [number, number][] {
  const out: [number, number][] = [];
  let s = start;
  let i = start;
  while (i < end) {
    const ch = body[i]!;
    if (ch === '.' || ch === '!' || ch === '?' || ch === '…') {
      let j = i + 1;
      while (j < end && /[.!?…]/.test(body[j]!)) j++;
      while (j < end && /["”’'»)\]]/.test(body[j]!)) j++;
      let k = j;
      while (k < end && /\s/.test(body[k]!)) k++;
      const spaced = k > j || j >= end;
      const next = body[k];
      const opens = next === undefined || /[\p{Lu}\p{N}"“‘'([«¿¡]/u.test(next);
      let abbreviation = false;
      if (ch === '.') {
        const before = /([\p{L}.]+)$/u.exec(body.slice(Math.max(start, i - 12), i))?.[1] ?? '';
        const word = before.toLowerCase();
        abbreviation = ABBREVIATIONS.has(word) || /^\p{Lu}$/u.test(before);
      }
      if (spaced && opens && !abbreviation) {
        out.push([s, j]);
        s = k;
        i = k;
        continue;
      }
      i = j;
      continue;
    }
    i++;
  }
  if (s < end) out.push([s, end]);
  return out.filter(([a, b]) => body.slice(a, b).trim().length > 0);
}

/** Tokenise a reader text. Linear in the length of the body. */
export function tokenizeReaderText(body: string): TokenizedText {
  const tokens: ReaderToken[] = [];
  const sentences: ReaderSentence[] = [];
  const paragraphs: ReaderParagraph[] = [];
  const addresses: [number, number][] = [];
  for (const m of body.matchAll(ADDRESS_RE)) addresses.push([m.index, m.index + m[0].length]);
  let addr = 0;
  const inAddress = (a: number, b: number) => {
    while (addr < addresses.length && addresses[addr]![1] <= a) addr++;
    const r = addresses[addr];
    return !!r && r[0] < b && a < r[1];
  };

  for (const [ps, pe] of paragraphRanges(body)) {
    const firstSentence = sentences.length;
    for (const [ss, se] of sentenceRanges(body, ps, pe)) {
      const sentenceIndex = sentences.length;
      const firstToken = tokens.length;
      const slice = body.slice(ss, se);
      let first = true;
      let prevEnd = 0;
      for (const m of slice.matchAll(WORD_RE)) {
        const start = ss + m.index;
        const text = m[0];
        const norm = normalizeTerm(text);
        const gap = slice.slice(prevEnd, m.index);
        prevEnd = m.index + text.length;
        // A word right after an opening quote or a colon starts a sentence of its own.
        const opensClause =
          first || /[:;]\s*["“‘']?\s*$/.test(gap) || /^\s*["“‘«]\s*$|[.!?]\s*["“‘«]\s*$/u.test(gap);
        first = false;
        const number = DIGIT_RE.test(text);
        const stray =
          !number &&
          [...text].filter((c) => LETTER_RE.test(c)).length === 1 &&
          norm !== 'a' &&
          norm !== 'i';
        const acronym =
          text.length > 1 && !HAS_LOWER_RE.test(text) && LETTER_RE.test(text) && !isPronounI(norm);
        const capital = UPPER_START_RE.test(text) && !isPronounI(norm);
        const proper = !number && (acronym || (capital && !opensClause));
        const address = inAddress(start, start + text.length);
        tokens.push({
          start,
          end: start + text.length,
          text,
          norm,
          sentence: sentenceIndex,
          proper,
          counted: !number && !stray && !proper && !address,
        });
      }
      sentences.push({
        start: ss,
        end: se,
        paragraph: paragraphs.length,
        firstToken,
        endToken: tokens.length,
      });
    }
    paragraphs.push({ start: ps, end: pe, firstSentence, endSentence: sentences.length });
  }

  // A capitalised word at the start of a sentence is a name too when the text only ever
  // writes it with a capital and uses it as a name elsewhere ("London is big. I like London.").
  const names = new Set<string>();
  const lower = new Set<string>();
  for (const t of tokens) {
    if (t.proper) names.add(t.norm);
    else if (!UPPER_START_RE.test(t.text)) lower.add(t.norm);
  }
  for (const t of tokens) {
    if (
      !t.proper &&
      t.counted &&
      UPPER_START_RE.test(t.text) &&
      names.has(t.norm) &&
      !lower.has(t.norm)
    ) {
      t.proper = true;
      t.counted = false;
    }
  }
  return { tokens, sentences, paragraphs };
}

/** Running-word counts per lemma of the counted tokens (the input of measureCoverage). */
export function lemmaCounts(
  tokens: readonly ReaderToken[],
  lemmatize: (norm: string) => string,
): Map<string, number> {
  const out = new Map<string, number>();
  const memo = new Map<string, string>();
  for (const t of tokens) {
    if (!t.counted) continue;
    let lemma = memo.get(t.norm);
    if (lemma === undefined) {
      lemma = lemmatize(t.norm);
      memo.set(t.norm, lemma);
    }
    out.set(lemma, (out.get(lemma) ?? 0) + 1);
  }
  return out;
}

/** Index of the sentence that contains `offset` (the last one before it), for resuming. */
export function sentenceAt(text: TokenizedText, offset: number): number {
  const s = text.sentences;
  if (s.length === 0) return 0;
  let lo = 0;
  let hi = s.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (s[mid]!.start <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Counted running words (the length a reader means by "1 000 kelimelik metin"). */
export const wordCount = (text: TokenizedText): number =>
  text.tokens.filter((t) => t.counted || t.proper).length;
