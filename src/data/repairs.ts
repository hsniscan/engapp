// One-off data repairs that run once per device, when the browser is idle. Each one writes
// through the normal actions, so the fixed rows sync to the other devices.
import { stripListEntry } from '../../supabase/functions/_shared/listEntry';
import type { Millis } from '../domain/types';
import { editSense } from './actions';
import { db } from './db';
import { getMeta, setMeta } from './meta';

const LIST_PREFIX_DONE = 'repair_list_prefix_v1';

/**
 * Senses imported from a word list before ai-extract cut the list prefix carry it in their
 * sentence ("1988 trailer I own a trailer."), which also blanks the headword in the cloze card.
 * Returns the number of senses fixed.
 */
export async function repairListEntrySentences(now: Millis = Date.now()): Promise<number> {
  if (await getMeta<boolean>(LIST_PREFIX_DONE)) return 0;
  const senses = await db.senses
    .filter((s) => s.deleted_at === null && !!s.source_sentence && /^\s*\d/.test(s.source_sentence))
    .toArray();
  const notes = await db.notes.bulkGet([...new Set(senses.map((s) => s.note_id))]);
  const termOf = new Map(notes.flatMap((n) => (n ? [[n.id, n.term] as const] : [])));
  let fixed = 0;
  for (const s of senses) {
    const term = termOf.get(s.note_id);
    if (!term || !s.source_sentence) continue;
    const clean = stripListEntry(s.source_sentence, term, s.span);
    if (clean.sentence === s.source_sentence || !clean.span) continue;
    await editSense(
      s.id,
      { source_sentence: clean.sentence, span: clean.span, source_sentence_tr: s.source_sentence_tr },
      now,
    );
    fixed++;
  }
  await setMeta(LIST_PREFIX_DONE, true);
  return fixed;
}
