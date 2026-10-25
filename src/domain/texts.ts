// Reading texts (v0.5, plan /mnt/project-files/plan/v0.5-plan.md, decision 0043): the shared
// contract the v0.5 packages build on. Pure TypeScript: no React, Dexie or network imports.
//
// Every way a text reaches the app (paste, PDF, shared link → article, photo → OCR, subtitle
// file, the graded library, the daily story) ends as one `ReaderText` row and opens in the
// reader at `readerPath(id)`. The reader (İP1) owns the screen, the coverage maths and the
// encounter counter; the other packages only create texts and navigate.
import type { Id, Millis, SyncedRow } from './types';

/** Where a text came from. 'graded' rows point at shared library texts (İP5). */
export type TextKind = 'paste' | 'pdf' | 'article' | 'ocr' | 'subtitle' | 'graded' | 'story';

export const TEXT_KINDS: readonly TextKind[] = [
  'paste',
  'pdf',
  'article',
  'ocr',
  'subtitle',
  'graded',
  'story',
];

/** Longest text the reader accepts (same bound as one text import). */
export const MAX_TEXT_CHARS = 300_000;

/**
 * A text the user reads. User-private: never written into shared tables (AGENTS rule 5) and,
 * like review history, never copied to another account (multi-account rule).
 */
export interface ReaderText extends SyncedRow {
  kind: TextKind;
  title: string;
  /** Plain text, paragraphs separated by a blank line. Empty for 'graded' (body is shared). */
  body: string;
  /** The article address for 'article', the file name for 'pdf' / 'subtitle'. */
  source_url: string | null;
  /** The shared library row for 'graded'; null otherwise. */
  graded_id: string | null;
  /** Character offset the user last read up to (resume point). */
  progress_offset: number;
  /** Total foreground reading time in ms. */
  read_ms: number;
  finished_at: Millis | null;
}

/** What a capture package hands over; saveText (data/texts.ts) fills the rest. */
export interface NewText {
  kind: TextKind;
  title: string;
  body: string;
  source_url?: string | null;
  graded_id?: string | null;
}

/** Where an encounter with a word happened (İP1 counter, İP8 story). */
export type EncounterSource = 'review' | 'reader' | 'story';

/** Times the user met a note on one day from one source. Never touches FSRS or review_logs. */
export interface EncounterRow {
  /** `${note_id}|${day}|${source}` */
  id: string;
  note_id: Id;
  /** Study day, YYYY-MM-DD (domain/day.ts). */
  day: string;
  source: EncounterSource;
  n: number;
}

export const encounterId = (noteId: Id, day: string, source: EncounterSource): string =>
  `${noteId}|${day}|${source}`;

/**
 * Reading difficulty (Hasan's choice, 2026-10-25): the share of unknown running words a
 * recommended or generated text may have. The hard cap of 10 % holds in every band.
 */
export type ReadingDifficulty = 'rahat' | 'dengeli' | 'zorlayici';

export const DIFFICULTY_BANDS: Record<ReadingDifficulty, { min: number; max: number }> = {
  rahat: { min: 0.02, max: 0.03 },
  dengeli: { min: 0.03, max: 0.05 },
  zorlayici: { min: 0.06, max: 0.1 },
};

export const DEFAULT_DIFFICULTY: ReadingDifficulty = 'dengeli';
export const UNKNOWN_RATE_CAP = 0.1;

/** Result of measuring a text against what the user knows (domain/coverage.ts, İP1). */
export interface CoverageResult {
  /** Counted running words (numbers, punctuation and proper nouns excluded). */
  tokens: number;
  /** Expected share of unknown running words, 0..1. */
  unknownRate: number;
  /** Lemmas the user most likely does not know, most frequent first. */
  unknownLemmas: string[];
}

export const readerPath = (id: Id): string => `/oku/${id}`;
