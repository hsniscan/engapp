// Word families and false friends (İP6): the device cache of the static morphology file,
// the user's words as the family rules need them, the user's feedback on false-friend
// warnings and root/affix cards.
import type { MorphemeEntry, UserWord } from '../domain/morphology';
import { morphemeMeaning } from '../domain/morphology';
import type { Millis, PairNoteFeedbackRow } from '../domain/types';
import { addNoteWithSenses, type AddNoteResult } from './actions';
import { db } from './db';
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

/** Keys of the false-friend warnings this user hid or reported on this device. */
export async function getHiddenPairNotes(): Promise<Set<string>> {
  return new Set(await db.pair_note_feedback.toCollection().primaryKeys());
}

/**
 * Hide a false-friend warning ("Gizle") or report it as wrong ("Hatalı"). Local until the
 * shared feedback table exists; `sent_at` stays null so it can be sent later.
 */
export async function setPairNoteFeedback(
  key: string,
  verdict: PairNoteFeedbackRow['verdict'],
  now: Millis = Date.now(),
): Promise<void> {
  await db.pair_note_feedback.put({ key, verdict, at: now, sent_at: null });
}

/** Undo "Gizle" (the toast's "Geri al"). */
export async function clearPairNoteFeedback(key: string): Promise<void> {
  await db.pair_note_feedback.delete(key);
}
