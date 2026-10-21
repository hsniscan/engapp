// Anti-hallucination checks: a candidate's sentence must occur verbatim in the chunk and
// its surface form must occur inside that sentence. Matching tolerates only what PDF
// extraction and models routinely change without changing the text: runs of whitespace
// (line breaks), typographic quotes/apostrophes/dashes and soft hyphens. Everything else
// (a changed word, a fixed typo, a dropped comma) fails the check.

interface Folded {
  text: string;
  /** map[i] = index in the original string of folded char i */
  map: number[];
}

const FOLD_CHAR: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '‚': "'",
  '‛': "'",
  ʼ: "'",
  '′': "'",
  '`': "'",
  '´': "'",
  '“': '"',
  '”': '"',
  '„': '"',
  '‟': '"',
  '″': '"',
  '«': '"',
  '»': '"',
  '‐': '-',
  '‑': '-',
  '‒': '-',
  '–': '-',
  '—': '-',
  '−': '-',
  ' ': ' ',
  ' ': ' ',
  ' ': ' ',
};

function fold(s: string, lower = false): Folded {
  let text = '';
  const map: number[] = [];
  let lastWasSpace = false;
  for (let i = 0; i < s.length; i++) {
    let ch = s[i]!;
    if (ch === '­' || ch === '​') continue; // soft hyphen, zero-width space
    ch = FOLD_CHAR[ch] ?? ch;
    if (/\s/.test(ch)) {
      if (lastWasSpace) continue;
      ch = ' ';
      lastWasSpace = true;
    } else {
      lastWasSpace = false;
    }
    const low = lower ? ch.toLowerCase() : ch;
    text += low.length === 1 ? low : ch; // keep 1:1 length so map stays aligned
    map.push(i);
  }
  return { text, map };
}

export interface Located {
  start: number;
  end: number; // exclusive
  text: string; // the original characters (source of truth for what is stored)
}

/** Locates `sentence` in `chunk`. Returns the chunk's own characters, or null. */
export function findSentence(chunk: string, sentence: string): Located | null {
  const needle = sentence.trim();
  if (needle.length === 0) return null;
  const exact = chunk.indexOf(needle);
  if (exact >= 0) return { start: exact, end: exact + needle.length, text: needle };

  const fc = fold(chunk);
  const fs = fold(needle).text.trim();
  if (fs.length === 0) return null;
  const at = fc.text.indexOf(fs);
  if (at < 0) return null;
  const start = fc.map[at]!;
  const end = fc.map[at + fs.length - 1]! + 1;
  return { start, end, text: chunk.slice(start, end) };
}

const LETTER = /[\p{L}\p{M}\p{N}]/u;

function atWordBoundary(s: string, start: number, end: number): boolean {
  const before = start > 0 ? s[start - 1]! : '';
  const after = end < s.length ? s[end]! : '';
  return !(before && LETTER.test(before)) && !(after && LETTER.test(after));
}

/**
 * [start, end) of `surface` inside `sentence`: first occurrence on word boundaries,
 * tried exact, then case-insensitive and folded. Null when it does not occur.
 */
export function findSpan(sentence: string, surface: string): [number, number] | null {
  const needle = surface.trim();
  if (needle.length === 0) return null;

  const scan = (hay: string, ndl: string, map?: number[]): [number, number] | null => {
    let from = 0;
    for (;;) {
      const at = hay.indexOf(ndl, from);
      if (at < 0) return null;
      const s = map ? map[at]! : at;
      const e = map ? map[at + ndl.length - 1]! + 1 : at + ndl.length;
      if (atWordBoundary(sentence, s, e)) return [s, e];
      from = at + 1;
    }
  };

  return (
    scan(sentence, needle) ??
    (() => {
      const fs = fold(sentence, true);
      return scan(fs.text, fold(needle, true).text.trim(), fs.map);
    })() ??
    findGappedSpan(sentence, needle)
  );
}

const WORD = /[\p{L}\p{M}\p{N}]+(?:['’-][\p{L}\p{M}\p{N}]+)*/gu;

/**
 * Separable phrasal verbs: the model may give "turned down" (or "turned ... down") for
 * "turned her application down". Finds the surface's words in order with at most
 * `maxGap` other words between neighbours; the span covers the whole stretch.
 */
export function findGappedSpan(
  sentence: string,
  surface: string,
  maxGap = 4,
  same: (sentenceWord: string, surfaceWord: string) => boolean = (a, b) => a === b,
): [number, number] | null {
  const want = [...fold(surface, true).text.matchAll(WORD)].map((m) => m[0]);
  if (want.length === 0) return null;
  const words = [...fold(sentence, true).text.matchAll(WORD)].map((m) => ({
    w: m[0],
    i: m.index ?? 0,
  }));
  const fs = fold(sentence, true);
  for (let start = 0; start < words.length; start++) {
    if (!same(words[start]!.w, want[0]!)) continue;
    let k = 1;
    let last = start;
    for (let j = start + 1; j < words.length && k < want.length; j++) {
      if (j - last - 1 > maxGap) break;
      if (same(words[j]!.w, want[k]!)) {
        k++;
        last = j;
      }
    }
    if (k === want.length) {
      const a = words[start]!;
      const b = words[last]!;
      return [fs.map[a.i]!, fs.map[b.i + b.w.length - 1]! + 1];
    }
  }
  return null;
}

/** True when sentence[span] is `surface` (ignoring case and folding). */
export function spanMatches(
  sentence: string,
  span: readonly [number, number],
  surface: string,
): boolean {
  const [s, e] = span;
  if (!(Number.isInteger(s) && Number.isInteger(e) && s >= 0 && e > s && e <= sentence.length))
    return false;
  return fold(sentence.slice(s, e), true).text.trim() === fold(surface, true).text.trim();
}
