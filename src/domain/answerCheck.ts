// Typed answers (Üretim, Boşluk doldurma and Dikte; redesign, v0.5 İP9, ADR 0051): how close the
// user's spelling is to the term, a letter-by-letter diff for the result screen, and the
// rating we suggest. Pure.
//
// The check is kind on purpose (over-strict checking is the most common complaint about typed
// answers in other apps). The verdicts:
//   correct   the term, after folding case, accents (é → e), Turkish keyboard letters
//             (ı → i, ş → s …), apostrophes ("dont" = "don't"), hyphens ("well known" =
//             "well-known") and edge punctuation; also "to go" ↔ "go", "the cat" ↔ "cat",
//             a phrase without its "sb / sth" placeholders, either part of "a/b", and the
//             other of British / American spelling ("colour" = "color", "realise" = "realize")
//   synonym   another English word for the same Turkish meaning (the data layer finds it in
//             the dictionary: data/synonyms.ts); it counts as right
//   close     "neredeyse": a small typo by Damerau–Levenshtein (a swap of two neighbours is
//             one edit): 1 letter for words of 3–7 letters, 2 from 8 letters on, none for
//             one- and two-letter words
//   wrong     anything else; skipped: nothing typed ("Bilmiyorum")
// The verdict only pre-selects a rating button; the user's tap is the rating.
import { damerauLevenshtein } from './confusables';
import { Rating, type RatingValue } from './types';

/** Lower case, trimmed, single spaces, typographic apostrophes and dashes straightened. */
export function normalizeAnswer(s: string): string {
  return s
    .normalize('NFC')
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/[‐-—]/g, '-')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('en');
}

/** Letters a Turkish keyboard (or its autocorrect) puts in place of the English ones. */
const KEYBOARD_LETTERS: Record<string, string> = { ı: 'i', ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', ł: 'l' };

/**
 * The comparison form of an answer: normalizeAnswer, then accents and dots removed (NFD
 * without combining marks, so "İ", "é", "ş", "ğ" lose them), "ı" → "i", apostrophes dropped,
 * hyphens and slashes read as spaces, other punctuation dropped.
 */
export function foldAnswer(s: string): string {
  return normalizeAnswer(s)
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[ıßæœøł]/g, (c) => KEYBOARD_LETTERS[c] ?? c)
    .replace(/'/g, '')
    .replace(/[-–/_]/g, ' ')
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const LEADING_WORDS = /^(?:to|a|an|the) /;
const PLACEHOLDERS = /\b(?:sb|sth|someone|somebody|something|one's|ones|oneself)\b/g;

/**
 * British and American spellings. Stems are listed where a general rule would also accept
 * misspellings of common words ("four" for "for", "watre" for "water").
 */
const OUR = '(col|hon|fav|lab|neighb|behavi|flav|hum|rum|vap|od|harb|arm|vig|savi|endeav|cand|clam|glam|parl|splend|ard|rig|tum|val)';
const RE = '(cent|theat|met|lit|fib|sab|calib|somb|lust|spect|meag|sepulch)';
const ENCE = '(def|lic|off|pret)';
const VARIANT_RULES: [RegExp, string][] = [
  [new RegExp(`\\b${OUR}our(s|ed|ing|ite|ites|able)?\\b`, 'g'), '$1or$2'], // colour → color
  [new RegExp(`\\b${OUR}or(s|ed|ing|ite|ites|able)?\\b`, 'g'), '$1our$2'],
  [/(\w{3,})is(e|ed|es|ing|ation|ations)\b/g, '$1iz$2'], // realise → realize
  [/(\w{3,})iz(e|ed|es|ing|ation|ations)\b/g, '$1is$2'],
  [/(\w{2,})ys(e|ed|es|ing)\b/g, '$1yz$2'], // analyse → analyze
  [/(\w{2,})yz(e|ed|es|ing)\b/g, '$1ys$2'],
  [new RegExp(`\\b${RE}re(s|d)?\\b`, 'g'), '$1er$2'], // centre → center
  [new RegExp(`\\b${RE}er(s|ed)?\\b`, 'g'), '$1re$2'],
  [/([^aeiou][aeiou])ll(ed|ing|er|ers)\b/g, '$1l$2'], // travelled → traveled
  [/([^aeiou][aeiou])l(ed|ing|er|ers)\b/g, '$1ll$2'],
  [/(\w{3,})ogue(s)?\b/g, '$1og$2'], // catalogue → catalog
  [/(\w{3,})og(s)?\b/g, '$1ogue$2'],
  [new RegExp(`\\b${ENCE}ence(s)?\\b`, 'g'), '$1ense$2'], // defence → defense
  [new RegExp(`\\b${ENCE}ense(s)?\\b`, 'g'), '$1ence$2'],
];

function spellingVariants(form: string): string[] {
  const out = new Set<string>();
  for (const [re, to] of VARIANT_RULES) {
    const v = form.replace(re, to);
    if (v !== form) out.add(v);
  }
  return [...out];
}

/** Folded ways of writing one answer: with and without "to"/"the", placeholders, "( )" parts. */
function answerForms(raw: string): string[] {
  const n = normalizeAnswer(raw);
  const pieces = new Set<string>([n]);
  // "(be) aware of" → "be aware of" and "aware of".
  if (/\(.*\)/.test(n)) {
    pieces.add(n.replace(/[()]/g, ''));
    pieces.add(n.replace(/\([^)]*\)/g, ' '));
  }
  // "colour/color", "to lie / lay": either side alone.
  for (const p of [...pieces]) if (p.includes('/')) for (const side of p.split('/')) pieces.add(side);
  const out = new Set<string>();
  for (const p of pieces) {
    const f = foldAnswer(p);
    if (!f) continue;
    out.add(f);
    const bare = f.replace(LEADING_WORDS, '');
    if (bare && bare !== f) out.add(bare);
    for (const x of [f, bare]) {
      const noPlaceholders = x.replace(PLACEHOLDERS, ' ').replace(/\s+/g, ' ').trim();
      if (noPlaceholders && noPlaceholders !== x) out.add(noPlaceholders);
    }
  }
  return [...out];
}

/** Forms of the term that count as right, spelling variants included. */
export function acceptedForms(term: string): string[] {
  const forms = new Set(answerForms(term));
  for (const f of [...forms]) for (const v of spellingVariants(f)) forms.add(v);
  return [...forms];
}

export type DiffOp =
  /** Same letter in both. */
  | { kind: 'same'; ch: string }
  /** The user typed `typed` where the answer has `expected`. */
  | { kind: 'sub'; typed: string; expected: string }
  /** A letter the user typed that the answer does not have. */
  | { kind: 'extra'; typed: string }
  /** A letter of the answer the user left out. */
  | { kind: 'missing'; expected: string };

/** Levenshtein alignment of two strings (by code point), as edit operations. */
export function diffLetters(typed: string, expected: string): DiffOp[] {
  const a = [...typed];
  const b = [...expected];
  const n = a.length;
  const m = b.length;
  const same = (x: string, y: string) => foldAnswer(x) === foldAnswer(y) || x.toLowerCase() === y.toLowerCase();
  const d: number[][] = Array.from({ length: n + 1 }, (_, i) => {
    const row = new Array<number>(m + 1).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= m; j++) d[0]![j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = same(a[i - 1]!, b[j - 1]!) ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
    }
  }
  const ops: DiffOp[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const eq = same(a[i - 1]!, b[j - 1]!);
      if (d[i]![j] === d[i - 1]![j - 1]! + (eq ? 0 : 1)) {
        ops.push(eq ? { kind: 'same', ch: b[j - 1]! } : { kind: 'sub', typed: a[i - 1]!, expected: b[j - 1]! });
        i--;
        j--;
        continue;
      }
    }
    if (j > 0 && (i === 0 || d[i]![j] === d[i]![j - 1]! + 1)) {
      ops.push({ kind: 'missing', expected: b[j - 1]! });
      j--;
    } else {
      ops.push({ kind: 'extra', typed: a[i - 1]! });
      i--;
    }
  }
  return ops.reverse();
}

/** Typing distance of two answers: Damerau–Levenshtein over their folded forms. */
export function editDistance(typed: string, expected: string): number {
  return damerauLevenshtein(foldAnswer(typed), foldAnswer(expected));
}

export type AnswerVerdict = 'correct' | 'synonym' | 'close' | 'wrong' | 'skipped';

export interface AnswerCheck {
  verdict: AnswerVerdict;
  /** Typing edits from the closest accepted form (0 when correct or a synonym). */
  distance: number;
  /** The answer to show as "Doğrusu" (the term as stored, or "go" for "to go"). */
  expected: string;
  /** The answer as typed, trimmed. */
  typed: string;
}

/** Letters a "close" answer may get wrong: none up to 2 letters, 1 up to 7, then 2. */
export function closeLimit(term: string): number {
  const n = [...foldAnswer(term).replace(/ /g, '')].length;
  if (n <= 2) return 0;
  return n >= 8 ? 2 : 1;
}

export interface CheckOptions {
  /**
   * Other English words for the same meaning (data/synonyms.ts). A typed answer equal to one of
   * them (folded, spelling variants included) is a 'synonym'.
   */
  synonyms?: readonly string[];
}

/** Is the typed answer one of these words (folded, with "to"/"the" and spelling variants)? */
export function matchesAny(typed: string, words: readonly string[]): string | null {
  const mine = new Set(answerForms(typed));
  for (const w of words) if (acceptedForms(w).some((f) => mine.has(f))) return w;
  return null;
}

export function checkAnswer(typed: string, term: string, opts: CheckOptions = {}): AnswerCheck {
  const shown = term.trim();
  const mine = answerForms(typed);
  if (mine.length === 0) return { verdict: 'skipped', distance: [...shown].length, expected: shown, typed: '' };
  const forms = acceptedForms(term);
  const full = foldAnswer(term);
  let best = { form: full, distance: Infinity };
  for (const t of mine) {
    for (const form of forms) {
      const dist = damerauLevenshtein(t, form, Math.max(3, best.distance));
      if (dist < best.distance) best = { form, distance: dist };
    }
  }
  // "Doğrusu" shows the term as stored, unless a shorter form ("go" for "to go") was nearer.
  const shorter = best.form !== full && answerForms(term).includes(best.form);
  const expected = shorter ? best.form : shown;
  const base = { typed: typed.trim(), expected };
  if (best.distance === 0) return { ...base, verdict: 'correct', distance: 0, expected: shown };
  if (opts.synonyms?.length && matchesAny(typed, opts.synonyms.filter((w) => foldAnswer(w) !== full)))
    return { ...base, verdict: 'synonym', distance: 0, expected: shown };
  const longest = Math.max(...mine.map((t) => [...t.replace(/ /g, '')].length));
  const verdict: AnswerVerdict =
    best.distance <= closeLimit(best.form) && longest > 1 ? 'close' : 'wrong';
  return { ...base, verdict, distance: best.distance };
}

/**
 * The answer button we suggest after a typed answer or a choice. Right (or a synonym) without
 * help: İyi. Right after a hint, or "neredeyse": Zor. Wrong or "Bilmiyorum": Tekrar. The user
 * can always pick another button.
 */
export function suggestRating(verdict: AnswerVerdict, usedHint: boolean): RatingValue {
  if (verdict === 'correct' || verdict === 'synonym') return usedHint ? Rating.Hard : Rating.Good;
  if (verdict === 'close') return Rating.Hard;
  return Rating.Again;
}
