// Text preparation for AI extraction: sentence split, ~6000-char chunks that never split a
// sentence (~3000 for a vocabulary list), PDF text cleanup, and chunk hashing for chunk_cache.

export const DEFAULT_CHUNK_SIZE = 6000;
/**
 * Chunk size for a vocabulary list. The model returns every entry of a list (not ~30
 * picks), ~120 output tokens each: 3000 chars of a numbered list ("12 bad Be careful of
 * bad people.", ~55 chars per entry) is ~50 entries, ~6k tokens, so one call stays well
 * inside the server's per-attempt timeout.
 */
export const LIST_CHUNK_SIZE = 3000;
/**
 * Longest chunk ai-extract accepts (MAX_CHUNK_CHARS in supabase/functions/_shared/
 * contracts.ts; a test keeps them equal). A "sentence" longer than this (a PDF table,
 * a word list without punctuation) is cut at spaces, or the job would fail on it forever.
 */
export const MAX_CHUNK_HARD = 8000;

export function splitSentences(text: string): string[] {
  const seg = new Intl.Segmenter('en', { granularity: 'sentence' });
  const out: string[] = [];
  for (const s of seg.segment(text)) {
    if (s.segment.trim() !== '') out.push(s.segment);
  }
  return out;
}

// An entry number ("12 bad …", "12. bad", "12) bad") at the start of the text or of a line,
// or after the end of the previous entry's sentence; or a bullet at the start of a line.
const ENTRY_START = /(?:^|\n|[.!?…]["”’)]?[ \t]+)[ \t]*(?:\d{1,4}[.):]?[ \t]+|[-•*–·▪][ \t]+)(?=\p{L})/gu;
// Where to cut a list so that every entry starts a unit (the text itself is not changed).
const ENTRY_CUT = /(?<=[.!?…]["”’)]?[ \t]+|\n)(?=[ \t]*(?:\d{1,4}[.):]?|[-•*–·▪])[ \t]+\p{L})/u;

/**
 * Does the text look like a vocabulary list or glossary: numbered or bulleted entries,
 * about as many as it has sentences ("12 bad Be careful of bad people. 13 big …")? At
 * least 10 entries are needed, so prose with a few numbered steps is not a list.
 */
export function looksLikeVocabularyList(text: string): boolean {
  const entries = text.match(ENTRY_START)?.length ?? 0;
  const sentences = text.match(/[.!?…]+["”’)]?(?=\s|$)/g)?.length ?? 0;
  return entries >= 10 && entries >= sentences * 0.5;
}

/**
 * List entries as units: sentence segments cut again before each entry number. The
 * sentence segmenter does not break "people. 13 good This…" (a lower-case word follows),
 * so a page of a list would otherwise be one long "sentence".
 */
function splitEntries(text: string): string[] {
  return splitSentences(text)
    .flatMap((s) => s.split(ENTRY_CUT))
    .filter((s) => s !== '');
}

/**
 * Group sentences into chunks of at most `size` characters (default: DEFAULT_CHUNK_SIZE, or
 * LIST_CHUNK_SIZE with one entry per unit when the text looks like a vocabulary list). A
 * single longer sentence becomes its own chunk; one over MAX_CHUNK_HARD is cut at spaces.
 * Chunks are trimmed; every sentence appears verbatim in exactly one chunk, so "source
 * sentence must occur in the chunk" checks hold.
 */
export function chunkText(text: string, size?: number): string[] {
  const list = looksLikeVocabularyList(text);
  const target = size ?? (list ? LIST_CHUNK_SIZE : DEFAULT_CHUNK_SIZE);
  return groupUnits(list ? splitEntries(text) : splitSentences(text), target);
}

function groupUnits(units: string[], size: number): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const sentence of units.flatMap((x) => splitLong(x, Math.min(size, MAX_CHUNK_HARD)))) {
    if (current !== '' && current.length + sentence.length > size) {
      chunks.push(current.trim());
      current = '';
    }
    current += sentence;
  }
  if (current.trim() !== '') chunks.push(current.trim());
  return chunks;
}

/** Cut a segment longer than MAX_CHUNK_HARD into pieces of at most `max`, at whitespace. */
function splitLong(segment: string, max: number): string[] {
  if (segment.length <= MAX_CHUNK_HARD) return [segment];
  const out: string[] = [];
  let rest = segment;
  while (rest.length > max) {
    let cut = rest.lastIndexOf(' ', max);
    if (cut <= 0) {
      cut = max; // no space at all: cut hard, but never inside a surrogate pair
      if (/[\uD800-\uDBFF]/.test(rest[cut - 1] ?? '')) cut--;
    }
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) out.push(rest);
  return out;
}

/** Join "exam-\nple" → "example" across line breaks. */
export function joinHyphenatedLines(text: string): string {
  return text.replace(/(\p{L})-[ \t]*\r?\n[ \t]*(\p{Ll})/gu, '$1$2');
}

function lineKey(line: string): string {
  return line.trim().replace(/\d+/g, '#').replace(/\s+/g, ' ').toLowerCase();
}

const EDGE_LINES = 2;

/**
 * Drop header/footer lines: among the first and last few lines of each page, a line
 * (digits ignored, so "Page 3" matches "Page 4") that recurs on more than half of the pages.
 */
export function removeRepeatedHeaders(pages: string[]): string[] {
  if (pages.length < 2) return pages;
  const split = pages.map((p) => p.split(/\r?\n/));
  const counts = new Map<string, number>();
  for (const lines of split) {
    const seen = new Set<string>();
    for (const i of edgeIndexes(lines)) {
      const k = lineKey(lines[i]!);
      if (k && !seen.has(k)) {
        seen.add(k);
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
    }
  }
  const repeated = new Set([...counts].filter(([, n]) => n > pages.length / 2).map(([k]) => k));
  return split.map((lines) => {
    const edges = new Set(edgeIndexes(lines));
    return lines.filter((l, i) => !(edges.has(i) && repeated.has(lineKey(l)))).join('\n');
  });
}

function edgeIndexes(lines: string[]): number[] {
  const nonEmpty = lines.map((l, i) => (l.trim() ? i : -1)).filter((i) => i >= 0);
  return [...new Set([...nonEmpty.slice(0, EDGE_LINES), ...nonEmpty.slice(-EDGE_LINES)])];
}

/**
 * PDF pages → one clean text: headers/footers removed, hyphenated breaks joined, single
 * line breaks inside paragraphs turned into spaces, blank lines kept as paragraph breaks.
 */
export function cleanPdfText(pages: string[]): string {
  const text = removeRepeatedHeaders(pages).join('\n'); // sentences may continue across pages
  return joinHyphenatedLines(text)
    .split(/\n[ \t]*\n+/)
    .map((p) => p.replace(/[ \t]*\r?\n[ \t]*/g, ' ').replace(/[ \t]+/g, ' ').trim())
    .filter((p) => p !== '')
    .join('\n\n');
}

export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** chunk_cache key: SHA-256 of the NFC-normalized chunk. */
export function hashChunk(chunk: string): Promise<string> {
  return sha256Hex(chunk.normalize('NFC'));
}
