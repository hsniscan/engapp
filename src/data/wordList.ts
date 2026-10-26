// "CSV ya da kelime listesi" (v0.5.1, decision 0056): the parsed rows (domain/wordList.ts)
// become the user's own notes through the normal add path, one at a time, so an existing word
// only gets the meanings it does not have yet. No AI, no account: works offline for guests.
import type { WordListRow } from '../domain/wordList';
import type { Millis } from '../domain/types';
import { addNoteWithSenses } from './actions';
import { ActionError } from './errors';
import { logError } from './errorLog';

export interface WordListResult {
  /** New notes. */
  created: number;
  /** Meanings added to notes the user already had. */
  addedSenses: number;
  /** Rows the user already had with that meaning. */
  unchanged: number;
  /** Rows that could not be saved (too long, empty after cleaning). */
  failed: number;
}

/** A row, with where its term is in its sentence (the screen finds it; null: no cloze card). */
export type WordListImportRow = WordListRow & { span?: [number, number] | null };

export async function importWordList(
  rows: readonly WordListImportRow[],
  onProgress?: (done: number) => void,
  now: Millis = Date.now(),
): Promise<WordListResult> {
  const res: WordListResult = { created: 0, addedSenses: 0, unchanged: 0, failed: 0 };
  let i = 0;
  for (const row of rows) {
    try {
      const sentence = row.sentence?.trim() || null;
      const r = await addNoteWithSenses(
        {
          term: row.term,
          senses: [
            {
              meaning_tr: row.meaning,
              source_sentence: sentence,
              span: sentence ? (row.span ?? null) : null,
            },
          ],
        },
        now + i,
      );
      if (r.status === 'created' || r.status === 'reactivated') res.created++;
      else if (r.addedSenses.length) res.addedSenses += r.addedSenses.length;
      else res.unchanged++;
    } catch (e) {
      res.failed++;
      if (!(e instanceof ActionError)) void logError(e, 'wordList.import');
    }
    i++;
    if (onProgress && i % 25 === 0) onProgress(i);
  }
  onProgress?.(rows.length);
  return res;
}
