// The encounter counter on this device (v0.5 İP1, decision 0043; rules in
// domain/encounters.ts). Rows are synced (server user_encounters, this user only, never
// copied to another account) and never touch FSRS fields or review_logs.
import { dayKeyOf } from '../domain/day';
import { bumpEncounters, summarizeEncounters, type EncounterSummary } from '../domain/encounters';
import type { EncounterRow, EncounterSource } from '../domain/texts';
import type { Id, Millis } from '../domain/types';
import { db } from './db';
import { getMeta, setMeta } from './meta';
import { dayConfig, getSettings } from './settings';
import { type SyncWriter, writeTx } from './writer';

/** Meta key: the notes already counted for a text on this device (v0.5.2: texts, not openings). */
export const readerCountedKey = (textId: Id): string => `reader_counted:${textId}`;

/** +1 for each note on today's row of this device and `source`. Call inside writeTx with db.encounters. */
export async function bumpEncountersIn(
  w: SyncWriter,
  noteIds: Iterable<Id>,
  source: EncounterSource,
  day: string,
): Promise<EncounterRow[]> {
  const ids = [...new Set(noteIds)];
  if (ids.length === 0) return [];
  const existing = (await db.encounters.where('day').equals(day).toArray()).filter(
    (r) => r.source === source && r.device_id === w.deviceId,
  );
  const rows = bumpEncounters(existing, ids, day, source, w.deviceId, (id) => w.base(id));
  return w.putMany('encounters', rows);
}

/**
 * The reader opened `textId` and the user's notes `noteIds` occur in it: one reader
 * encounter for each note the first time this device shows it in this text. "3 metinde" then
 * means three texts, however often one of them is opened or reloaded (v0.5.2, ADR 0063).
 * `openKey` (the router's location key) is kept for callers; it no longer decides anything.
 * Returns how many notes were counted.
 */
export async function recordReaderEncounters(
  textId: Id,
  openKey: string,
  noteIds: readonly Id[],
  now: Millis = Date.now(),
  source: EncounterSource = 'reader',
): Promise<number> {
  void openKey;
  const day = dayKeyOf(now, dayConfig(await getSettings(now)));
  return writeTx([db.encounters], now, async (w) => {
    const key = readerCountedKey(textId);
    const seen = new Set((await getMeta<string[]>(key)) ?? []);
    const fresh = [...new Set(noteIds)].filter((id) => !seen.has(id));
    if (fresh.length === 0) return 0;
    for (const id of fresh) seen.add(id);
    await setMeta(key, [...seen]);
    return (await bumpEncountersIn(w, fresh, source, day)).length;
  });
}

/** "Bu kelimeyi N kez gördün: x kartta, y metinde". Safe in useLiveQuery. */
export async function getEncounterSummary(noteId: Id): Promise<EncounterSummary> {
  return db.transaction('r', [db.encounters, db.cards, db.review_logs], async () => {
    const rows = await db.encounters.where('note_id').equals(noteId).toArray();
    const cardIds = (await db.cards.where('note_id').equals(noteId).primaryKeys()) as Id[];
    const answers = cardIds.length
      ? await db.review_logs
          .where('card_id')
          .anyOf(cardIds)
          .filter((l) => l.undo_of === null)
          .count()
      : 0;
    return summarizeEncounters(rows, answers);
  });
}
