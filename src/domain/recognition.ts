// Recognition card sentence rotation and cloze/production helpers.
import { effectiveLogs } from './recompute';
import type { Id, ReviewLog, Sense } from './types';

type SenseLike = Pick<Sense, 'id' | 'sense_no' | 'source_sentence' | 'deleted_at'>;

/** Senses whose sentence can be shown, in display order. */
export function sentenceSenses<T extends SenseLike>(senses: Iterable<T>): T[] {
  return [...senses]
    .filter((s) => s.deleted_at === null && !!s.source_sentence && s.source_sentence.trim() !== '')
    .sort((a, b) => a.sense_no - b.sense_no || (a.id < b.id ? -1 : 1));
}

/** shown_sense_id of the latest non-undone answer that recorded one. */
export function lastShownSenseId(logs: Iterable<ReviewLog>): Id | null {
  const eff = effectiveLogs(logs);
  for (let i = eff.length - 1; i >= 0; i--) {
    const id = eff[i]!.shown_sense_id;
    if (id) return id;
  }
  return null;
}

/**
 * Which sense's sentence the recognition card shows next: the one after the last shown,
 * wrapping around. Null when no sense has a sentence (show the term alone).
 */
export function nextRecognitionSense<T extends SenseLike>(senses: Iterable<T>, lastShownId: Id | null): T | null {
  const list = sentenceSenses(senses);
  if (list.length === 0) return null;
  if (lastShownId === null) return list[0]!;
  const idx = list.findIndex((s) => s.id === lastShownId);
  if (idx === -1) {
    // Last shown sense lost its sentence or was deleted: continue after its position.
    return list[0]!;
  }
  return list[(idx + 1) % list.length]!;
}

export type Span = [number, number];

/** [start, end) lies inside the sentence, is non-empty and not just whitespace. */
export function isValidSpan(sentence: string, span: Span | null | undefined): span is Span {
  if (!span) return false;
  const [start, end] = span;
  if (!Number.isInteger(start) || !Number.isInteger(end)) return false;
  if (start < 0 || end > sentence.length || start >= end) return false;
  return sentence.slice(start, end).trim() !== '';
}

/** Case-insensitive first occurrence of `surface` in `sentence` (fallback when no span). */
export function findSpan(sentence: string, surface: string): Span | null {
  const needle = surface.trim().toLowerCase();
  if (!needle) return null;
  const idx = sentence.toLowerCase().indexOf(needle);
  return idx === -1 ? null : [idx, idx + needle.length];
}

export interface Cloze {
  before: string;
  answer: string;
  after: string;
  /** Sentence with the span replaced by the blank. */
  masked: string;
}

export const CLOZE_BLANK = '_____';

export function makeCloze(sentence: string, span: Span, blank = CLOZE_BLANK): Cloze {
  if (!isValidSpan(sentence, span)) throw new Error('Cloze span is outside the sentence');
  const before = sentence.slice(0, span[0]);
  const answer = sentence.slice(span[0], span[1]);
  const after = sentence.slice(span[1]);
  return { before, answer, after, masked: before + blank + after };
}

/** Cloze cards exist only for senses with a sentence and a valid span. */
export function canHaveCloze(sense: Pick<Sense, 'source_sentence' | 'span'>): boolean {
  return !!sense.source_sentence && isValidSpan(sense.source_sentence, sense.span);
}

/** Production card hint: first letter of each word, the rest blanked ("give up" → "g___ u_"). */
export function firstLetterHint(term: string): string {
  return term
    .trim()
    .split(/\s+/)
    .map((w) => {
      const chars = [...w];
      return chars[0] + chars.slice(1).map((c) => (/[\p{L}\p{N}]/u.test(c) ? '_' : c)).join('');
    })
    .join(' ');
}
