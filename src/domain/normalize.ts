const APOSTROPHES = /[‘’‚‛ʼʹ′`´＇]/g;
const QUOTES = /[“”„‟″«»＂]/g;
const DASHES = /[‐‑‒–—−]/g;

/**
 * Normal form used for uniqueness (notes.term_norm) and duplicate checks:
 * NFC, typographic apostrophes/quotes/dashes folded to ASCII, lower-case,
 * trimmed, inner whitespace collapsed to one space.
 */
export function normalizeTerm(input: string): string {
  return (
    fold(input)
      // A dotted capital "İ" (typed on a Turkish keyboard) is a plain "i", not "i" plus a
      // combining dot; "I" stays "i" because the term is English (review 2026-11-26 #4).
      .replace(/İ/g, 'i')
      .toLowerCase()
      .replace(/\s+/gu, ' ')
      .trim()
  );
}

/**
 * normalizeTerm for a Turkish meaning: lower-cased with Turkish rules ("İhmal" = "ihmal",
 * "IŞIK" = "ışık"), so two spellings of one meaning compare equal.
 */
export function normalizeMeaningTr(input: string): string {
  return fold(input).toLocaleLowerCase('tr').replace(/\s+/gu, ' ').trim();
}

const fold = (input: string) =>
  input.normalize('NFC').replace(APOSTROPHES, "'").replace(QUOTES, '"').replace(DASHES, '-');

/** Same folding without lower-casing; for display values the user typed. */
export function cleanText(input: string): string {
  return input
    .normalize('NFC')
    .replace(APOSTROPHES, "'")
    .replace(/\s+/gu, ' ')
    .trim();
}
