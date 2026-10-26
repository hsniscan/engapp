// "CSV ya da kelime listesi" (v0.5.1, decision 0056). Pure: a CSV / TSV file or a typed list
// ("give up - vazgeçmek", "bank;kıyı;We sat on the bank.") becomes rows of term, meaning and an
// optional example sentence. Nothing here touches the AI: the user's own meanings become cards
// on this device, like the hand-written form.

/** At most this many rows per import (a larger file is cut, and the screen says so). */
export const MAX_LIST_ROWS = 2000;

export interface WordListRow {
  term: string;
  meaning: string;
  sentence: string | null;
}

export interface WordListParse {
  rows: WordListRow[];
  /** Lines with text that gave no term and meaning. */
  skipped: number;
  /** More than MAX_LIST_ROWS rows were found. */
  truncated: boolean;
}

/** Splits one CSV line on `sep`, honouring "quoted, fields" and "" escapes. */
export function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"' && cur.trim() === '') {
      quoted = true;
      cur = '';
    } else if (line.startsWith(sep, i)) {
      out.push(cur);
      cur = '';
      i += sep.length - 1;
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/** Separators tried, most specific first. A dash or "=" only with spaces around it. */
const SEPARATORS = ['\t', ';', ' = ', ' – ', ' — ', ' - ', ',', ':'] as const;

/** The separator most lines share (null when no line has one). */
export function detectSeparator(lines: readonly string[]): string | null {
  const sample = lines.slice(0, 50);
  let best: { sep: string; hits: number } | null = null;
  for (const sep of SEPARATORS) {
    const hits = sample.filter((l) => splitCsvLine(l, sep).filter(Boolean).length >= 2).length;
    if (hits > 0 && (!best || hits > best.hits)) best = { sep, hits };
    // A separator nearly every line has wins at once (tab and ";" before ",").
    if (best && best.hits >= Math.ceil(sample.length * 0.8)) break;
  }
  return best?.sep ?? null;
}

/** A line's cells: the list's separator, else the first one that splits this line (mixed lists). */
function cellsOf(line: string, sep: string | null): string[] {
  for (const s of sep ? [sep, ...SEPARATORS] : []) {
    const cells = splitCsvLine(line, s).map(clean);
    if (cells.filter(Boolean).length >= 2) return cells;
  }
  return [clean(line)];
}

const HEADER = /^(term|word|english|ingilizce|kelime|front|question|en)$/i;

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Parses a CSV / TSV file or a typed word list. */
export function parseWordList(text: string): WordListParse {
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r\n|\r|\n/)
    .filter((l) => l.trim() !== '');
  const sep = detectSeparator(lines);
  const rows: WordListRow[] = [];
  let skipped = 0;
  let truncated = false;
  lines.forEach((line, i) => {
    const cells = cellsOf(line, sep);
    const [term = '', ...rest] = cells.filter((c, j) => j === 0 || c !== '');
    // The last cell is an example sentence only when it reads like one (three words or more);
    // otherwise it is more of the meaning ("bank, kıyı, sahil").
    const last = rest.length >= 2 ? rest[rest.length - 1]! : '';
    const isSentence = last.split(' ').filter((w) => /\p{L}/u.test(w)).length >= 3;
    const meaning = (isSentence ? rest.slice(0, -1) : rest).join(', ');
    const sentence = isSentence ? last : '';
    if (i === 0 && HEADER.test(term)) return;
    if (!/\p{L}/u.test(term) || !/\p{L}/u.test(meaning)) {
      skipped++;
      return;
    }
    if (rows.length >= MAX_LIST_ROWS) {
      truncated = true;
      return;
    }
    rows.push({ term, meaning, sentence: /\p{L}/u.test(sentence) ? sentence : null });
  });
  return { rows, skipped, truncated };
}
