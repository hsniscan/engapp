// "Kelimelerimi temalara ayır", data side: which words go to ai-themes, and the local preview
// (theme_previews, never synced) until the user approves it. Approved groups become tags.
import { acceptedGroups, MAX_THEME_RUN_WORDS, type ThemeSourceNote } from '../domain/themes';
import { withTags } from '../domain/tags';
import type { Id, Millis, Sense, ThemePreview } from '../domain/types';
import { db } from './db';
import { writeTx } from './writer';

export const THEME_PREVIEW_ID = 'current';

export interface ThemeSource {
  /** Words to send, newest first, at most MAX_THEME_RUN_WORDS. */
  notes: ThemeSourceNote[];
  /** All words that qualified (may be more than `notes`). */
  total: number;
}

/**
 * Live notes without tags (or all live notes with `includeTagged`), newest first, each with
 * the English gloss of its first sense (from the note or the lexicon cache). Only the term
 * and that gloss are ever sent: no meaning, sentence or user text.
 */
export async function getThemeSource(opts: { includeTagged?: boolean } = {}): Promise<ThemeSource> {
  return db.transaction('r', [db.notes, db.senses, db.lexicon_cache], async () => {
    const notes = (await db.notes.filter((n) => n.deleted_at === null).toArray())
      .filter((n) => opts.includeTagged || n.tags.length === 0)
      .sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? 1 : -1));
    const picked = notes.slice(0, MAX_THEME_RUN_WORDS);
    const ids = new Set(picked.map((n) => n.id));
    const first = new Map<Id, Sense>();
    await db.senses.where('note_id').anyOf([...ids]).each((s) => {
      if (s.deleted_at !== null) return;
      const cur = first.get(s.note_id);
      if (!cur || s.sense_no < cur.sense_no) first.set(s.note_id, s);
    });
    const lexIds = [...first.values()]
      .filter((s) => !s.gloss_en && s.lexicon_sense_id)
      .map((s) => s.lexicon_sense_id!);
    const lex = new Map((await db.lexicon_cache.bulkGet(lexIds)).filter((x) => !!x).map((x) => [x!.id, x!]));
    return {
      total: notes.length,
      notes: picked.map((n) => {
        const s = first.get(n.id);
        const gloss = s?.gloss_en || (s?.lexicon_sense_id ? lex.get(s.lexicon_sense_id)?.gloss_en : null) || null;
        return { id: n.id, term: n.term, gloss_en: gloss };
      }),
    };
  });
}

export async function getThemePreview(): Promise<ThemePreview | null> {
  return (await db.theme_previews.get(THEME_PREVIEW_ID)) ?? null;
}

export async function saveThemePreview(p: Omit<ThemePreview, 'id'>): Promise<void> {
  await db.theme_previews.put({ ...p, id: THEME_PREVIEW_ID });
}

/** Apply an edit to the stored preview (name, removed words, rejected flag). */
export async function updateThemePreview(fn: (p: ThemePreview) => ThemePreview): Promise<void> {
  await db.transaction('rw', db.theme_previews, async () => {
    const cur = await db.theme_previews.get(THEME_PREVIEW_ID);
    if (cur) await db.theme_previews.put({ ...fn(cur), id: THEME_PREVIEW_ID });
  });
}

export async function discardThemePreview(): Promise<void> {
  await db.theme_previews.delete(THEME_PREVIEW_ID);
}

export interface ApplyThemesResult {
  /** Groups that became tags. */
  tags: string[];
  /** Notes that got a tag. */
  notes: number;
  /** Notes left unchanged because they already have the maximum number of tags. */
  full: number;
}

/**
 * Turn the approved groups into tags (one transaction, one outbox row per changed note) and
 * remove the preview. Deleted notes are skipped.
 */
export async function applyThemePreview(now: Millis = Date.now()): Promise<ApplyThemesResult> {
  return writeTx([db.notes, db.theme_previews], now, async (w) => {
    const preview = await db.theme_previews.get(THEME_PREVIEW_ID);
    const res: ApplyThemesResult = { tags: [], notes: 0, full: 0 };
    if (!preview) return res;
    const groups = acceptedGroups(preview.groups);
    const touched = new Map<Id, string[]>();
    for (const g of groups) for (const id of g.noteIds) touched.set(id, [...(touched.get(id) ?? []), g.name]);
    const notes = await db.notes.bulkGet([...touched.keys()]);
    const used = new Set<string>();
    for (const note of notes) {
      if (!note || note.deleted_at !== null) continue;
      const add = touched.get(note.id)!;
      const next = withTags(note.tags, add);
      if (!next) {
        res.full++;
        continue;
      }
      if (next.length !== note.tags.length) {
        await w.put('notes', { ...note, tags: next });
        res.notes++;
        for (const t of add) used.add(t);
      }
    }
    res.tags = groups.map((g) => g.name).filter((n) => used.has(n));
    await db.theme_previews.delete(THEME_PREVIEW_ID);
    return res;
  });
}
