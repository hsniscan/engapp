// Word families and false friends (İP6): the device cache of the static morphology file,
// the user's words as the family rules need them, the user's feedback on false-friend
// warnings and root/affix cards.
import type { MorphemeEntry, UserWord } from '../domain/morphology';
import { morphemeMeaning } from '../domain/morphology';
import { contentRowId, feedbackRowId } from '../domain/examples';
import type { Id, Millis } from '../domain/types';
import { addNoteWithSenses, type AddNoteResult } from './actions';
import { db } from './db';
import { setContentFeedback } from './examples';
import { getMeta, setMeta } from './meta';

// ------------------------------------------------------------------ reference file cache

/**
 * A static reference file, fetched once and kept in Dexie (ref_cache) so it also works
 * offline and in guest mode. A new build has a new checksum: the old copy is replaced on the
 * next online use and kept as long as the new one cannot be fetched.
 */
export async function loadRefFile<T>(
  key: string,
  asset: { url: string; sha256: string },
  fetcher: (url: string) => Promise<Response> = (url) => fetch(url),
  now: Millis = Date.now(),
): Promise<T> {
  const cached = await db.ref_cache.get(key);
  if (cached && cached.sha256 === asset.sha256) return cached.data as T;
  try {
    const res = await fetcher(asset.url);
    if (!res.ok) throw new Error(`${asset.url}: HTTP ${res.status}`);
    const data = (await res.json()) as T;
    await db.ref_cache.put({ key, sha256: asset.sha256, data, fetched_at: now });
    return data;
  } catch (e) {
    if (cached) return cached.data as T;
    throw e;
  }
}

// ------------------------------------------------------------------ the user's words

export interface UserWordSets {
  /** Live word/phrase/pattern notes. */
  words: UserWord[];
  /** term_norm of every live note, for "already carded". */
  terms: Set<string>;
  /** term_norm of live affix notes. */
  affixTerms: string[];
}

export async function getUserWordSets(): Promise<UserWordSets> {
  const notes = await db.notes.filter((n) => n.deleted_at === null).toArray();
  notes.sort((a, b) => a.created_at - b.created_at);
  return {
    words: notes.filter((n) => n.term_type !== 'affix').map((n) => ({ term: n.term, term_norm: n.term_norm })),
    terms: new Set(notes.map((n) => n.term_norm)),
    affixTerms: notes.filter((n) => n.term_type === 'affix').map((n) => n.term_norm),
  };
}

// ------------------------------------------------------------------ root/affix cards

const DISMISSED_MORPHEMES = 'family_dismissed_morphemes';

/** Morphemes whose card suggestion the user closed on this device. */
export async function getDismissedMorphemes(): Promise<Set<string>> {
  return new Set((await getMeta<string[]>(DISMISSED_MORPHEMES)) ?? []);
}

export async function dismissMorphemeSuggestion(id: string): Promise<void> {
  await db.transaction('rw', db.meta, async () => {
    const list = (await getMeta<string[]>(DISMISSED_MORPHEMES)) ?? [];
    if (!list.includes(id)) await setMeta(DISMISSED_MORPHEMES, [...list, id]);
  });
}

/**
 * A recognition-only card for a root or affix: the front shows its form ("-spect-"), the
 * back its Turkish meaning and the user's words that carry it.
 */
export function addMorphemeCard(m: MorphemeEntry, now: Millis = Date.now()): Promise<AddNoteResult> {
  const { meaning } = morphemeMeaning(m);
  return addNoteWithSenses(
    {
      term: m.form,
      term_type: 'affix',
      senses: [{ meaning_tr: meaning, gloss_en: m.gloss_en, pos: m.kind }],
    },
    now,
  );
}

// ------------------------------------------------------------------ false-friend feedback
//
// "Gizle" / "Hatalı" on a false-friend warning is a content_feedback row (İP5's synced,
// per-user feedback table): target_kind 'false_friend', target_id derived from the warning's
// key, verdict 'skip' (hidden) or 'reject' (reported as wrong). So it syncs to the user's
// other devices, is in backups, and never crosses Google accounts (decision 0009).

/** target_kind of feedback on a false-friend warning. */
export const FALSE_FRIEND_TARGET = 'false_friend';

export type PairNoteVerdict = 'dismissed' | 'reported';

/**
 * Stable target id of a false-friend warning: UUID v8 of SHA-256 over
 * ("pair_note", "en-tr", key), key = `${term_norm}|${tr_word}` (domain/pairNotes.ts). The
 * server can derive the same id from lexicon_pair_notes (term_norm, content_key).
 */
export const pairNoteTargetId = (key: string): Promise<Id> =>
  contentRowId(['pair_note', 'en-tr', key]);

/**
 * content_feedback row ids of these warnings, mapped back to their keys. Async (hashing):
 * compute it outside live queries and pass it to getHiddenPairNotes.
 */
export async function pairNoteFeedbackIds(keys: readonly string[]): Promise<Map<Id, string>> {
  const out = new Map<Id, string>();
  for (const key of new Set(keys)) out.set(await feedbackRowId(FALSE_FRIEND_TARGET, await pairNoteTargetId(key)), key);
  return out;
}

/** Keys (of the given ones) whose warning this user hid or reported. Dexie reads only. */
export async function getHiddenPairNotes(ids: ReadonlyMap<Id, string>): Promise<Set<string>> {
  const rowIds = [...ids.keys()];
  const rows = rowIds.length ? await db.content_feedback.bulkGet(rowIds) : [];
  const out = new Set<string>();
  rows.forEach((r, i) => {
    if (r && r.deleted_at === null && r.target_kind === FALSE_FRIEND_TARGET) out.add(ids.get(rowIds[i]!)!);
  });
  return out;
}

/** Hide a false-friend warning ("Gizle") or report it as wrong ("Hatalı"). */
export async function setPairNoteFeedback(
  key: string,
  verdict: PairNoteVerdict,
  now: Millis = Date.now(),
): Promise<void> {
  const target = await pairNoteTargetId(key);
  await setContentFeedback(FALSE_FRIEND_TARGET, target, verdict === 'dismissed' ? 'skip' : 'reject', now);
}

/** Undo "Gizle" / "Hatalı" (the toast's "Geri al"): the row becomes a tombstone. */
export async function clearPairNoteFeedback(key: string, now: Millis = Date.now()): Promise<void> {
  await setContentFeedback(FALSE_FRIEND_TARGET, await pairNoteTargetId(key), null, now);
}
