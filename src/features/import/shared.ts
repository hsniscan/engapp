/** Longest text accepted in one import (~50 chunks; the daily AI budget is the real limit). */
export const MAX_IMPORT_CHARS = 300_000;

/** "After years of trying, Maria…" → a readable default title. */
export function firstWords(text: string, max = 48): string {
  const line = text.split(/\n/)[0]!.replace(/\s+/g, ' ').trim();
  if (line.length <= max) return line;
  const cut = line.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 24)).trim()}…`;
}
