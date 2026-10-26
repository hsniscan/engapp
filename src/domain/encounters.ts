// The encounter counter (v0.5 İP1, plan "Karşılaşma sayacı", decision 0043). Pure.
//
// "Bu kelimeyi 7 kez gördün: 4 kartta, 3 metinde." A reader encounter is one opening of a
// text that contains the word (however often it occurs there); a review encounter is one
// answer to one of the word's cards. Counting never touches FSRS fields or review_logs.
import { encounterId, READING_OFFSET_MAX, READING_OFFSET_STEP, type EncounterRow, type EncounterSource, type TextFeedback } from './texts';
import type { Id, Millis, SyncedRow } from './types';

export interface EncounterSummary {
  /** In the cards (answers). */
  cards: number;
  /** In texts (the reader and the daily story). */
  texts: number;
  total: number;
}

/**
 * Rows to write when `noteIds` were met `source`-wise on `day` on this device: each note's row
 * gets +1 (a new row starts at 1). `existing` are the device's current rows of that day and
 * source (any others are ignored). Duplicate ids in `noteIds` count once.
 */
export function bumpEncounters(
  existing: readonly EncounterRow[],
  noteIds: Iterable<Id>,
  day: string,
  source: EncounterSource,
  deviceId: string,
  base: (id: string) => SyncedRow,
): EncounterRow[] {
  const byId = new Map(existing.map((r) => [r.id, r]));
  const out: EncounterRow[] = [];
  for (const noteId of new Set(noteIds)) {
    const id = encounterId(noteId, day, source, deviceId);
    const row = byId.get(id);
    if (row) out.push({ ...row, n: row.n + 1, deleted_at: null });
    else out.push({ ...base(id), note_id: noteId, day, source, n: 1, device_id: deviceId });
  }
  return out;
}

/**
 * The line on the word sheet. `answers`: answers ever given to the note's cards (review
 * logs, not counting undo rows) — the review counter only starts with v0.5, the logs go back
 * to the first answer, so the larger of the two is shown.
 */
export function summarizeEncounters(rows: readonly EncounterRow[], answers = 0): EncounterSummary {
  let review = 0;
  let texts = 0;
  for (const r of rows) {
    if (r.deleted_at !== null || r.n <= 0) continue;
    if (r.source === 'review') review += r.n;
    else texts += r.n;
  }
  const cards = Math.max(review, answers);
  return { cards, texts, total: cards + texts };
}

/**
 * New settings.reading_offset after the user answered `next` on a text that had `prev`
 * (null = none): the old answer's nudge is taken back, the new one applied, bounded.
 */
export function nudgeOffset(current: number, prev: TextFeedback | null, next: TextFeedback | null): number {
  const step = (f: TextFeedback | null) => (f === 'hard' ? READING_OFFSET_STEP : f === 'easy' ? -READING_OFFSET_STEP : 0);
  const base = Number.isFinite(current) ? current : 0;
  const v = base - step(prev) + step(next);
  const bounded = Math.min(READING_OFFSET_MAX, Math.max(-READING_OFFSET_MAX, v));
  return Math.round(bounded * 100) / 100 || 0; // never -0
}

/** Reading time added by one foreground stretch; long idle gaps count as at most `cap`. */
export function readingSlice(from: Millis, to: Millis, cap = 2 * 60_000): number {
  const d = to - from;
  return d > 0 ? Math.min(cap, d) : 0;
}
