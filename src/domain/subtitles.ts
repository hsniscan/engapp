// Subtitle files (.srt / .vtt) → a readable text (v0.5 İP2, decision 0044). Pure: parsed on
// the device, nothing is uploaded. Cue numbers, timings, styling tags, positioning, speaker
// labels and sound descriptions go; the lines of consecutive cues are merged into sentences,
// and the sentences into paragraphs at pauses in the speech. Repeated lines (rolling
// auto-captions show every line twice) are kept once.

export interface SubtitleText {
  title: string;
  /** Paragraphs separated by a blank line (the ReaderText body format). */
  body: string;
  /** Cues that had text. */
  cues: number;
}

export type SubtitleFormat = 'srt' | 'vtt';

interface Cue {
  start: number; // ms
  end: number; // ms
  lines: string[];
}

/** A pause at least this long between two cues may start a new paragraph. */
export const PARAGRAPH_PAUSE_MS = 2500;
/** A paragraph is closed at the next sentence end once it is this long. */
export const PARAGRAPH_MAX_CHARS = 700;

const TIMING =
  /^\s*((?:\d+:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)\s*-->\s*((?:\d+:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)/;

/** "01:02:03,450", "02:03.450" or "1:02:03" → milliseconds. */
export function parseTimestamp(s: string): number {
  const [hms, frac = '0'] = s.trim().split(/[.,]/);
  const parts = hms!.split(':').map(Number);
  while (parts.length < 3) parts.unshift(0);
  const [h, m, sec] = parts as [number, number, number];
  return ((h * 60 + m) * 60 + sec) * 1000 + Number(frac.padEnd(3, '0').slice(0, 3));
}

export function detectSubtitleFormat(text: string, fileName = ''): SubtitleFormat | null {
  const head = text.replace(/^﻿/, '').trimStart();
  if (/^WEBVTT\b/.test(head) || /\.vtt$/i.test(fileName)) return 'vtt';
  if (/\.srt$/i.test(fileName) || TIMING.test(head.split('\n').slice(0, 3).join('\n')))
    return 'srt';
  return /-->/.test(head) ? 'srt' : null;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  lrm: '',
  rlm: '',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/**
 * One subtitle line as plain speech: no tags, no positioning, no speaker label, no sound
 * description. Returns '' when nothing is left.
 */
export function cleanCueLine(raw: string): string {
  let s = raw;
  s = s.replace(/\{\\[^}]*\}/g, ''); // ASS/SSA overrides: {\an8}, {\i1}
  s = s.replace(/<v(?:\.[^\s>]+)?\s+[^>]*>/gi, ''); // VTT voice span <v Roger>
  s = s.replace(/<\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?>/g, ''); // VTT karaoke timestamps
  s = s.replace(/<\/?[a-z][^>]*>/gi, ''); // <i>, </b>, <font color=…>, <c.yellow>, <ruby>
  s = decodeEntities(s);
  s = s.replace(/\[[^\]]*\]/g, ' '); // [MUSIC], [door slams]
  s = s.replace(/\(([^)]*)\)/g, (m, inner: string, at: number, whole: string) =>
    // (LAUGHS), (sighs) — a whole-line or all-capital aside, or a short one that opens the line
    // ("(laughs) You look tired."); keep "(in 1990)" in a sentence
    inner === inner.toUpperCase() ||
    raw.trim() === m ||
    (whole.slice(0, at).trim() === '' && inner.trim().split(/\s+/).length <= 3)
      ? ' '
      : m,
  );
  s = s.replace(/[♪♫♬]+/g, ' ');
  s = s.replace(/^\s*>>+\s*/, ''); // ">> " speaker change of auto-captions
  s = s.replace(/^\s*[-–—]\s+/, ''); // "- Hi." dialogue dash
  // "JOHN: Hello", "MAN 2: Hey", "DR. SMITH: …" (upper-case labels only: "Note: x" stays)
  s = s.replace(/^\s*[A-Z][A-Z0-9 .'’-]{0,30}:\s+/, '');
  s = s.replace(/\s+/g, ' ').trim();
  // A line that is only punctuation (left over after removing a sound description).
  return /\p{L}|\p{N}/u.test(s) ? s : '';
}

/**
 * An SDH scene heading or caption card, not speech: "KITCHEN - MORNING", "INT. OFFICE – DAY",
 * "THREE YEARS LATER", "PARIS, 1942". All capitals with no sentence end, and either a heading
 * prefix, a dash between parts or at least two words (a lone "STOP" stays). Only used when the
 * file is not written in capitals throughout (review 2026-11-26, ekle.md #10).
 */
export function isSceneHeading(line: string): boolean {
  const s = line.trim();
  if (!/\p{Lu}.*\p{Lu}/u.test(s) || /\p{Ll}/u.test(s)) return false;
  if (/^(INT|EXT|INT\/EXT)\.\s/.test(s)) return true;
  if (/[.!?…]["'”’)]*$/.test(s)) return false;
  return /\s[-–—]\s/.test(s) || /^\S+(?:,?\s+\S+)+$/.test(s);
}

const isAllCaps = (line: string) => /\p{Lu}/u.test(line) && !/\p{Ll}/u.test(line);

function parseCues(text: string, format: SubtitleFormat): Cue[] {
  const blocks = text
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n+/);
  const cues: Cue[] = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const at = lines.findIndex((l) => TIMING.test(l));
    if (at < 0) continue; // WEBVTT header, NOTE, STYLE, REGION, or noise
    if (format === 'vtt' && /^(NOTE|STYLE|REGION)\b/.test(lines[0] ?? '')) continue;
    const m = TIMING.exec(lines[at]!)!;
    cues.push({
      start: parseTimestamp(m[1]!),
      end: parseTimestamp(m[2]!),
      lines: lines.slice(at + 1),
    });
  }
  return cues.sort((a, b) => a.start - b.start);
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const SENTENCE_END = /[.!?…]["'”’)]*$/;

/** Parses an .srt or .vtt file into a readable text. Throws on a file with no cue text. */
export function parseSubtitles(text: string, fileName = ''): SubtitleText {
  const format = detectSubtitleFormat(text, fileName);
  if (!format) throw new Error('not a subtitle file');
  const cues = parseCues(text, format);

  // Scene headings go, unless the whole file is in capitals (old SRTs often are).
  const cleaned = cues.map((c) => c.lines.map(cleanCueLine).filter(Boolean));
  const speech = cleaned.flat().filter((l) => !isSceneHeading(l));
  const capsFile = !speech.length || speech.filter(isAllCaps).length > speech.length / 2;

  // Lines in speaking order, each with the time it starts; repeats dropped.
  const out: { text: string; start: number; end: number }[] = [];
  let withText = 0;
  for (const [i, cue] of cues.entries()) {
    const lines = cleaned[i]!.filter((l) => capsFile || !isSceneHeading(l));
    if (lines.length) withText++;
    for (const line of lines) {
      const key = norm(line);
      if (!key) continue;
      const recent = out.slice(-3);
      if (recent.some((r) => norm(r.text) === key)) continue;
      const last = out[out.length - 1];
      // Rolling captions grow a line word by word: "I went" → "I went to the shop".
      if (last && key.startsWith(norm(last.text) + ' ') && cue.start - last.end < 1500) {
        last.text = line;
        last.end = cue.end;
        continue;
      }
      out.push({ text: line, start: cue.start, end: cue.end });
    }
  }

  const paragraphs: string[] = [];
  let current = '';
  let prevEnd = -Infinity;
  for (const l of out) {
    const pause = l.start - prevEnd;
    if (
      current &&
      SENTENCE_END.test(current) &&
      (pause >= PARAGRAPH_PAUSE_MS || current.length >= PARAGRAPH_MAX_CHARS)
    ) {
      paragraphs.push(current);
      current = '';
    }
    if (!current) current = l.text;
    else if (/(\.\.\.|…)$/.test(current) && /^(\.\.\.|…)/.test(l.text)) {
      // "We were..." + "...waiting" → "We were waiting"
      current = `${current.replace(/(\.\.\.|…)$/, '')} ${l.text.replace(/^(\.\.\.|…)/, '')}`;
    } else current = `${current} ${l.text}`;
    current = current.replace(/\s+/g, ' ').trim();
    prevEnd = Math.max(prevEnd, l.end);
  }
  if (current) paragraphs.push(current);

  const body = paragraphs.join('\n\n');
  if (!body) throw new Error('no subtitle text');
  return { title: subtitleTitle(fileName), body, cues: withText };
}

/** "Some.Show.S01E02.1080p.WEB.en.srt" → "Some Show S01E02"; '' when nothing is left. */
export function subtitleTitle(fileName: string): string {
  const base = fileName
    .replace(/^.*[\\/]/, '')
    .replace(/\.(srt|vtt)$/i, '')
    .replace(/[._]+/g, ' ')
    .replace(
      /\b(\d{3,4}p|web(?:-?dl|rip)?|bluray|bdrip|hdtv|x26[45]|h ?26[45]|hevc|aac|ddp?\d?(?: \d)?|en|eng|english|forced|sdh|cc)\b/gi,
      ' ',
    )
    .replace(/[-\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return base;
}
