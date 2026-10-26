// Reading texts on this device (v0.5 contract, see domain/texts.ts; reader İP1, decision
// 0043). Capture packages call saveText() and navigate to readerPath(id); the reader owns the
// rest. Every write goes through the sync writer: `texts` is a synced table (server
// user_texts, this user only, never copied to another account).
import { nudgeOffset } from '../domain/encounters';
import type { Id, Millis } from '../domain/types';
import { MAX_TEXT_CHARS, type NewText, type ReaderText, type TextFeedback } from '../domain/texts';
import { db } from './db';
import { ActionError } from './errors';
import { getMeta, setMeta } from './meta';
import { defaultSettings, SETTINGS_ID } from './settings';
import { writeTx } from './writer';

/** Longest title kept (the server's limit). */
export const MAX_TITLE_CHARS = 300;

/** Store a new text and return its id. Text longer than MAX_TEXT_CHARS is cut. */
export async function saveText(input: NewText, now = Date.now()): Promise<Id> {
  return writeTx([db.texts], now, async (w) => {
    const row: ReaderText = {
      ...w.base(),
      kind: input.kind,
      title: input.title.trim().slice(0, MAX_TITLE_CHARS),
      body: input.body.slice(0, MAX_TEXT_CHARS),
      source_url: input.source_url ?? null,
      graded_id: input.graded_id ?? null,
      progress_offset: 0,
      read_ms: 0,
      finished_at: null,
      feedback: null,
      ...(input.story ? { story: input.story } : {}),
    };
    await w.put('texts', row);
    return row.id;
  });
}

export async function getText(id: Id): Promise<ReaderText | undefined> {
  const row = await db.texts.get(id);
  return row && row.deleted_at === null ? row : undefined;
}

/** Live texts, most recently read or added first. Safe in useLiveQuery. */
export async function listTexts(): Promise<ReaderText[]> {
  const rows = await db.texts.orderBy('updated_at').reverse().toArray();
  return rows.filter((r) => r.deleted_at === null);
}

/** The text to continue on Bugün: the most recently read one that is not finished. */
export async function lastUnfinishedText(): Promise<ReaderText | null> {
  return (await listTexts()).find((t) => t.finished_at === null) ?? null;
}

async function change(
  id: Id,
  now: Millis,
  fn: (t: ReaderText) => ReaderText | null,
): Promise<ReaderText> {
  return writeTx([db.texts], now, async (w) => {
    const row = await db.texts.get(id);
    if (!row || row.deleted_at !== null) throw new ActionError('not_found');
    const next = fn(row);
    if (!next) return row;
    return w.put('texts', next);
  });
}

/**
 * Remember where the user is and add foreground reading time. Called when the reader is left
 * or hidden (not on every scroll: one write, one outbox row). Reaching the end does not finish
 * a text; "Bitirdim" does.
 */
export function saveReadingProgress(
  id: Id,
  offset: number,
  addMs: number,
  now: Millis = Date.now(),
): Promise<ReaderText> {
  return change(id, now, (t) => {
    const progress_offset = Math.max(0, Math.min(Math.round(offset), t.body.length));
    const read_ms = t.read_ms + Math.max(0, Math.round(addMs));
    if (progress_offset === t.progress_offset && read_ms === t.read_ms) return null;
    return { ...t, progress_offset, read_ms };
  });
}

/** "Bitirdim" (finished = true) or "Yeniden oku" (false: back to unfinished, from the top). */
export function setTextFinished(
  id: Id,
  finished: boolean,
  now: Millis = Date.now(),
): Promise<ReaderText> {
  return change(id, now, (t) =>
    finished
      ? t.finished_at !== null
        ? null
        : { ...t, finished_at: now }
      : t.finished_at === null
        ? null
        : { ...t, finished_at: null, progress_offset: 0 },
  );
}

/** "Metni sil": a tombstone (synced), like every other deletion. */
export function deleteText(id: Id, now: Millis = Date.now()): Promise<ReaderText> {
  return change(id, now, (t) => ({ ...t, deleted_at: now }));
}

/**
 * "Çok zor" / "Çok kolay" (null takes the answer back). The text keeps the answer and the
 * settings' reading_offset moves once per text (domain/encounters.ts nudgeOffset), in the same
 * transaction, so a changed answer never counts twice.
 */
export async function setTextFeedback(
  id: Id,
  feedback: TextFeedback | null,
  now: Millis = Date.now(),
): Promise<number> {
  return writeTx([db.texts, db.settings], now, async (w) => {
    const text = await db.texts.get(id);
    if (!text || text.deleted_at !== null) throw new ActionError('not_found');
    const prev = text.feedback ?? null;
    const settings = (await db.settings.get(SETTINGS_ID)) ?? defaultSettings(now, w.userId);
    const current = settings.reading_offset ?? 0;
    if (prev === feedback) return current;
    const offset = nudgeOffset(current, prev, feedback);
    await w.put('texts', { ...text, feedback });
    if (offset !== current) await w.put('settings', { ...settings, reading_offset: offset });
    return offset;
  });
}

/** Device flag: the reader's colour legend was shown once (v0.5.1, decision 0054). */
const LEGEND_SEEN_KEY = 'reader_legend_seen';

/** The colour legend was shown and closed on this device. Safe in useLiveQuery. */
export async function readerLegendSeen(): Promise<boolean> {
  return (await getMeta<boolean>(LEGEND_SEEN_KEY)) === true;
}

export async function markReaderLegendSeen(): Promise<void> {
  await setMeta(LEGEND_SEEN_KEY, true);
}
