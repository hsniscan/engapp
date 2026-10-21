const APOSTROPHES = /[‘’‚‛ʼʹ′`´＇]/g;
const QUOTES = /[“”„‟″«»＂]/g;
const DASHES = /[‐‑‒–—−]/g;

/**
 * Normal form used for uniqueness (notes.term_norm) and duplicate checks:
 * NFC, typographic apostrophes/quotes/dashes folded to ASCII, lower-case,
 * trimmed, inner whitespace collapsed to one space.
 */
export function normalizeTerm(input: string): string {
  return input
    .normalize('NFC')
    .replace(APOSTROPHES, "'")
    .replace(QUOTES, '"')
    .replace(DASHES, '-')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();
}

/** Same folding without lower-casing; for display values the user typed. */
export function cleanText(input: string): string {
  return input
    .normalize('NFC')
    .replace(APOSTROPHES, "'")
    .replace(/\s+/gu, ' ')
    .trim();
}
