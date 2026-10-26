// Text from a photo (v0.5 İP3, docs/decisions/0045-ocr.md). Pure: no React, Dexie or network.
//
// Both recognisers (ML Kit on Android, tesseract.js on the web) are mapped to `OcrResult`:
// blocks of lines with boxes in image pixels and a 0..1 confidence. The review screen turns the
// lines into `ReviewLine`s the user can untick and edit; `rebuildText` makes the reader's plain
// text out of what is left: lines of a paragraph joined (a word hyphenated at the end of a line
// is put back together), paragraphs rebuilt from the geometry, separated by a blank line.

export interface OcrBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OcrLine {
  text: string;
  box: OcrBox;
  /** 0..1; null when the engine gives none. */
  confidence: number | null;
}

export interface OcrBlock {
  box: OcrBox;
  lines: OcrLine[];
}

export type OcrEngine = 'mlkit' | 'tesseract';

export interface OcrResult {
  engine: OcrEngine;
  /** Size of the image the boxes refer to. */
  width: number;
  height: number;
  /** In the engine's reading order. */
  blocks: OcrBlock[];
}

/** One recognised line on the review screen. */
export interface ReviewLine {
  /** `${block}-${line}`, stable for React keys. */
  id: string;
  block: number;
  text: string;
  box: OcrBox;
  confidence: number | null;
  included: boolean;
}

/** A line below this confidence is marked on the review screen. */
export const LOW_LINE_CONFIDENCE = 0.6;
/** Below this (character-weighted mean) the whole photo gets the "check the text" warning. */
export const LOW_PAGE_CONFIDENCE = 0.75;
/** Fewer letters than this: "no text found". */
export const MIN_LETTERS = 12;
/** Longest side of the image handed to a recogniser (enough for book print; keeps it < 3 s). */
export const MAX_IMAGE_SIDE = 2400;

const LIGATURES: Record<string, string> = {
  ﬀ: 'ff',
  ﬁ: 'fi',
  ﬂ: 'fl',
  ﬃ: 'ffi',
  ﬄ: 'ffl',
  ﬅ: 'st',
  ﬆ: 'st',
};

/** Ligatures spelled out, invisible characters dropped, inner whitespace collapsed. */
export function cleanLine(s: string): string {
  return s
    .replace(/[ﬀ-ﬆ]/g, (c) => LIGATURES[c] ?? c)
    .replace(/[​-‍﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const letters = (s: string) => (s.match(/\p{L}/gu) ?? []).length;

/**
 * Lines that are almost never wanted: page numbers ("12", "- 12 -", "xiv") and specks of one or
 * two characters. They start unticked; the user can tick them back.
 */
export function isNoiseLine(text: string): boolean {
  const t = cleanLine(text);
  if (!t) return true;
  if (/^[\s\-–—.·•|]*\d{1,4}[\s\-–—.·•|]*$/.test(t)) return true;
  // Lowercase roman page numbers (front matter): i … xxxix.
  if (/^x{0,3}(ix|iv|v?i{0,3})$/.test(t)) return true;
  return t.replace(/\s/g, '').length <= 2 && letters(t) <= 1;
}

/** The recognised lines as the review screen starts them: noise unticked, empty lines dropped. */
export function toReviewLines(result: OcrResult): ReviewLine[] {
  const out: ReviewLine[] = [];
  result.blocks.forEach((b, bi) => {
    b.lines.forEach((l, li) => {
      const text = cleanLine(l.text);
      if (!text) return;
      out.push({
        id: `${bi}-${li}`,
        block: bi,
        text,
        box: l.box,
        confidence: l.confidence,
        included: !isNoiseLine(text),
      });
    });
  });
  return out;
}

export interface OcrQuality {
  letters: number;
  /** Character-weighted mean confidence of the lines that have one; null when none has. */
  confidence: number | null;
  /** Nothing usable was found. */
  empty: boolean;
  /** Worth a "check the text against the photo" warning. */
  low: boolean;
}

export function ocrQuality(lines: readonly Pick<ReviewLine, 'text' | 'confidence'>[]): OcrQuality {
  let n = 0;
  let weighted = 0;
  let weight = 0;
  for (const l of lines) {
    const k = letters(l.text);
    n += k;
    if (l.confidence !== null && k > 0) {
      weighted += l.confidence * k;
      weight += k;
    }
  }
  const confidence = weight > 0 ? weighted / weight : null;
  const empty = n < MIN_LETTERS;
  return {
    letters: n,
    confidence,
    empty,
    low: !empty && confidence !== null && confidence < LOW_PAGE_CONFIDENCE,
  };
}

export const isLowConfidence = (l: Pick<ReviewLine, 'confidence'>): boolean =>
  l.confidence !== null && l.confidence < LOW_LINE_CONFIDENCE;

/**
 * Words commonly written with a hyphen: "self-" at a line end followed by "aware" keeps its
 * hyphen ("self-aware"); any other "exam-" + "ple" is a hyphenation and is joined ("example").
 */
const HYPHEN_PREFIXES = new Set([
  'self',
  'well',
  'ill',
  'non',
  'ex',
  'all',
  'half',
  'cross',
  'anti',
  'multi',
  'semi',
  'pseudo',
  'quasi',
  'vice',
  'mid',
  'pre',
  'post',
  'long',
  'short',
  'high',
  'low',
  'full',
  'part',
  'one',
  'two',
  'three',
  'four',
  'five',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
]);

export interface RebuildOptions {
  /**
   * Optional word check (e.g. the lexicon): decides "data-" + "base" → "database" when the joined
   * word is known, and keeps the hyphen when it is not but both halves are.
   */
  isWord?: (word: string) => boolean;
}

const HYPHENS = /[-­‐‑]$/;

/** Joins two consecutive lines of one paragraph. */
export function joinLines(a: string, b: string, opts: RebuildOptions = {}): string {
  if (!a) return b;
  if (!b) return a;
  const m = /(\p{L}+)[-­‐‑]$/u.exec(a);
  const next = /^(\p{L}+)/u.exec(b);
  if (m && next && /^\p{Ll}/u.test(b)) {
    const head = m[1]!;
    const tail = next[1]!;
    const stem = a.slice(0, -1);
    const lower = head.toLowerCase();
    const isWord = opts.isWord;
    let keep = HYPHEN_PREFIXES.has(lower);
    if (isWord) {
      const joined = (head + tail).toLowerCase();
      if (isWord(joined)) keep = false;
      else if (isWord(lower) && isWord(tail.toLowerCase())) keep = true;
    }
    if (a.endsWith('­')) keep = false;
    return keep ? `${stem}-${b}` : `${stem}${b}`;
  }
  if (HYPHENS.test(a) && !/\s[-‐‑]$/.test(a)) {
    // "well-" + "Known" or "1990-" + "95": a real hyphen, keep it, no space.
    return a.endsWith('­') ? `${a.slice(0, -1)}${b}` : `${a}${b}`;
  }
  if (/\S—$/.test(a)) return `${a}${b}`;
  return `${a} ${b}`;
}

const SENTENCE_END = /[.!?…:;]["'”’)\]]*$/;
const median = (xs: number[]) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((p, q) => p - q);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

interface BlockGeometry {
  /** Median line height. */
  lineH: number;
  /** Median distance from one line's top to the next (the block's leading). */
  pitch: number;
  left: number;
  right: number;
}

/**
 * Does `cur` start a new paragraph after `prev` inside one block? A clearly larger step down
 * than the block's usual line pitch, a first-line indent, or a short line that ended a sentence
 * before it. Compared with the block's own pitch, so loose and tight leading both work.
 */
function breaksParagraph(prev: ReviewLine, cur: ReviewLine, g: BlockGeometry): boolean {
  const step = cur.box.y - prev.box.y;
  if (g.pitch > 0 && step > g.pitch + g.lineH * 0.5) return true;
  const indent = cur.box.x - g.left;
  const prevIndent = prev.box.x - g.left;
  if (indent > g.lineH * 0.9 && prevIndent < g.lineH * 0.5) return true;
  const width = g.right - g.left;
  const prevShort = g.right - (prev.box.x + prev.box.w) > width * 0.25;
  if (prevShort && SENTENCE_END.test(prev.text) && width > g.lineH * 8) return true;
  return false;
}

/**
 * The text the reader gets: included lines only, in recognition order, paragraphs separated by
 * a blank line. Each block is at least one paragraph; a block that continues the previous one
 * mid-sentence (lowercase start after no sentence end) is joined to it.
 */
export function rebuildText(lines: readonly ReviewLine[], opts: RebuildOptions = {}): string {
  const kept = lines
    .map((l) => ({ ...l, text: cleanLine(l.text) }))
    .filter((l) => l.included && l.text);
  if (kept.length === 0) return '';

  // Geometry per block, from the lines that are kept (an unticked caption must not widen it).
  const byBlock = new Map<number, ReviewLine[]>();
  for (const l of kept) {
    const arr = byBlock.get(l.block) ?? [];
    arr.push(l);
    byBlock.set(l.block, arr);
  }
  const ctxOf = new Map<number, BlockGeometry>();
  for (const [b, ls] of byBlock) {
    const steps = ls.slice(1).map((l, i) => l.box.y - ls[i]!.box.y);
    ctxOf.set(b, {
      lineH: median(ls.map((l) => l.box.h)) || 1,
      pitch: median(steps),
      left: Math.min(...ls.map((l) => l.box.x)),
      right: Math.max(...ls.map((l) => l.box.x + l.box.w)),
    });
  }

  const paragraphs: string[] = [];
  let current = '';
  let prev: ReviewLine | null = null;
  for (const l of kept) {
    let newPara: boolean;
    if (!prev) newPara = true;
    else if (prev.block !== l.block) {
      const continues = !SENTENCE_END.test(current) && /^\p{Ll}/u.test(l.text);
      newPara = !continues;
    } else newPara = breaksParagraph(prev, l, ctxOf.get(l.block)!);

    if (newPara) {
      if (current) paragraphs.push(current);
      current = l.text;
    } else current = joinLines(current, l.text, opts);
    prev = l;
  }
  if (current) paragraphs.push(current);
  return paragraphs.join('\n\n');
}

/** Size to draw an image at so its longest side is at most `max` (never upscaled). */
export function fitWithin(
  width: number,
  height: number,
  max = MAX_IMAGE_SIDE,
): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= max || long <= 0) return { width: Math.round(width), height: Math.round(height) };
  const k = max / long;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/** A short title for the saved text: its first words. */
export function ocrTitle(text: string, max = 48): string {
  const line = (text.split(/\n/)[0] ?? '').replace(/\s+/g, ' ').trim();
  if (line.length <= max) return line;
  const cut = line.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 24)).trim()}…`;
}
