// Typed answers (Üretim and Boşluk doldurma, redesign): how close the user's spelling is to the
// term, a letter-by-letter diff for the result screen, and the rating we suggest. Pure.
import { Rating, type RatingValue } from './types';

/** Lower case, trimmed, single spaces, straight apostrophes and hyphens kept as typed. */
export function normalizeAnswer(s: string): string {
  return s
    .normalize('NFC')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[‐-—]/g, '-')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('en');
}

/** Forms of the term that count as right: "to go" also accepts "go", and the other way round. */
function acceptedForms(term: string): string[] {
  const t = normalizeAnswer(term);
  const forms = new Set([t]);
  if (t.startsWith('to ') && t.length > 3) forms.add(t.slice(3));
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
  const d: number[][] = Array.from({ length: n + 1 }, (_, i) => {
    const row = new Array<number>(m + 1).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= m; j++) d[0]![j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1]!.toLowerCase() === b[j - 1]!.toLowerCase() ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
    }
  }
  const ops: DiffOp[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const same = a[i - 1]!.toLowerCase() === b[j - 1]!.toLowerCase();
      if (d[i]![j] === d[i - 1]![j - 1]! + (same ? 0 : 1)) {
        ops.push(
          same
            ? { kind: 'same', ch: b[j - 1]! }
            : { kind: 'sub', typed: a[i - 1]!, expected: b[j - 1]! },
        );
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

export function editDistance(typed: string, expected: string): number {
  return diffLetters(typed, expected).filter((o) => o.kind !== 'same').length;
}

export type AnswerVerdict = 'correct' | 'close' | 'wrong' | 'skipped';

export interface AnswerCheck {
  verdict: AnswerVerdict;
  /** Letters that differ from the closest accepted form (0 when correct). */
  distance: number;
  /** The accepted form the answer was compared with (what "Doğrusu" shows). */
  expected: string;
  /** The answer as typed, trimmed. */
  typed: string;
}

/** Letters a "close" answer may get wrong: 1, and 2 from 8 letters on. */
export function closeLimit(term: string): number {
  return [...term].length >= 8 ? 2 : 1;
}

export function checkAnswer(typed: string, term: string): AnswerCheck {
  const t = normalizeAnswer(typed);
  const shown = term.trim();
  if (!t) return { verdict: 'skipped', distance: [...shown].length, expected: shown, typed: '' };
  let best = { form: normalizeAnswer(term), distance: Infinity };
  for (const form of acceptedForms(term)) {
    const dist = editDistance(t, form);
    if (dist < best.distance) best = { form, distance: dist };
  }
  // "Doğrusu" shows the term as stored, unless the shorter form ("go" for "to go") matched better.
  const expected = best.form === normalizeAnswer(term) ? shown : best.form;
  const verdict: AnswerVerdict =
    best.distance === 0
      ? 'correct'
      : best.distance <= closeLimit(best.form) && [...t].length > 1
        ? 'close'
        : 'wrong';
  return { verdict, distance: best.distance, expected, typed: typed.trim() };
}

/**
 * The answer button we suggest after a typed answer or a choice. Right without help: İyi.
 * Right after a hint, or one letter off: Zor. Wrong or "Bilmiyorum": Tekrar. The user can
 * always pick another button.
 */
export function suggestRating(verdict: AnswerVerdict, usedHint: boolean): RatingValue {
  if (verdict === 'correct') return usedHint ? Rating.Hard : Rating.Good;
  if (verdict === 'close') return Rating.Hard;
  return Rating.Again;
}
