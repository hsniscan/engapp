// Reading texts on this device (v0.5 contract, see domain/texts.ts). Capture packages call
// saveText() and navigate to readerPath(id); the reader (İP1) owns everything else, including
// making `texts` a synced table.
import type { Id } from '../domain/types';
import { MAX_TEXT_CHARS, type NewText, type ReaderText } from '../domain/texts';
import { db } from './db';
import { writeTx } from './writer';

/** Store a new text and return its id. Text longer than MAX_TEXT_CHARS is cut. */
export async function saveText(input: NewText, now = Date.now()): Promise<Id> {
  return writeTx([db.texts], now, async (w) => {
    const row: ReaderText = {
      ...w.base(),
      kind: input.kind,
      title: input.title.trim().slice(0, 300),
      body: input.body.slice(0, MAX_TEXT_CHARS),
      source_url: input.source_url ?? null,
      graded_id: input.graded_id ?? null,
      progress_offset: 0,
      read_ms: 0,
      finished_at: null,
    };
    await db.texts.add(row);
    return row.id;
  });
}

export async function getText(id: Id): Promise<ReaderText | undefined> {
  const row = await db.texts.get(id);
  return row && row.deleted_at === null ? row : undefined;
}
