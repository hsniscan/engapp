// "Kelimelerimi temalara ayır": batching the words for ai-themes and turning the answers into
// a preview the user edits. Pure: no Dexie, no React, no network.
//
// Privacy: a batch carries only the term and the shared lexicon's English gloss, keyed by a
// short ref ("w1"); note ids, meanings, sentences and tags never leave the device.
import type { Id, ThemePreviewGroup } from './types';
import { cleanTag, tagKey } from './tags';

export const THEME_BATCH_SIZE = 200;
/** At most this many words per run (5 AI calls); the newest notes first. */
export const MAX_THEME_RUN_WORDS = 1000;
/** Fewer words than this are not worth a call. */
export const MIN_THEME_WORDS = 6;

export interface ThemeSourceNote {
  id: Id;
  term: string;
  gloss_en: string | null;
}

export interface ThemeBatch {
  words: { ref: string; lemma: string; gloss_en: string | null }[];
  /** ref → note id, kept on the device. */
  refs: Map<string, Id>;
}

/** Split notes into batches of THEME_BATCH_SIZE with refs w1…wN per batch. */
export function buildThemeBatches(
  notes: readonly ThemeSourceNote[],
  size = THEME_BATCH_SIZE,
): ThemeBatch[] {
  const out: ThemeBatch[] = [];
  for (let i = 0; i < notes.length; i += size) {
    const slice = notes.slice(i, i + size);
    const refs = new Map<string, Id>();
    const words = slice.map((n, j) => {
      const ref = `w${j + 1}`;
      refs.set(ref, n.id);
      return {
        ref,
        lemma: [...n.term].slice(0, 80).join(''),
        gloss_en: n.gloss_en ? [...n.gloss_en].slice(0, 200).join('') : null,
      };
    });
    out.push({ words, refs });
  }
  return out;
}

export interface ThemeAnswer {
  groups: { name_tr: string; refs: string[] }[];
}

/**
 * Merge the answers of all batches into preview groups: refs mapped back to note ids, groups
 * with the same name (case-insensitive) joined, each note in at most one group, groups of
 * fewer than two notes dropped, largest first.
 */
export function mergeThemeAnswers(
  batches: readonly ThemeBatch[],
  answers: readonly ThemeAnswer[],
): ThemePreviewGroup[] {
  const byName = new Map<string, ThemePreviewGroup>();
  const placed = new Set<Id>();
  answers.forEach((answer, i) => {
    const batch = batches[i];
    if (!batch) return;
    for (const g of answer.groups) {
      const name = cleanTag(g.name_tr);
      if (!name) continue;
      const key = tagKey(name);
      let group = byName.get(key);
      if (!group) {
        group = { key, suggested: name, name, note_ids: [], removed: [], rejected: false };
        byName.set(key, group);
      }
      for (const ref of g.refs) {
        const id = batch.refs.get(ref);
        if (!id || placed.has(id)) continue;
        placed.add(id);
        group.note_ids.push(id);
      }
    }
  });
  return [...byName.values()]
    .filter((g) => g.note_ids.length >= 2)
    .sort((a, b) => b.note_ids.length - a.note_ids.length || a.name.localeCompare(b.name, 'tr'));
}

/** Notes of a group the user keeps (not removed, still live). */
export function keptNotes(g: ThemePreviewGroup, live?: ReadonlySet<Id>): Id[] {
  const removed = new Set(g.removed);
  return g.note_ids.filter((id) => !removed.has(id) && (!live || live.has(id)));
}

/** Groups that will become tags: not rejected, a usable name and at least one kept note. */
export function acceptedGroups(
  groups: readonly ThemePreviewGroup[],
  live?: ReadonlySet<Id>,
): { name: string; noteIds: Id[] }[] {
  return groups
    .filter((g) => !g.rejected)
    .map((g) => ({ name: cleanTag(g.name), noteIds: keptNotes(g, live) }))
    .filter((g) => g.name && g.noteIds.length > 0);
}
