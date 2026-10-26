// Example rotation, data side (v0.5 İP10, docs/decisions/0052-smart-review.md): sentences from
// the user's own reading texts (`texts`, Dexie 28; a graded library text through its cached
// sentences in `graded_bodies`) for a card's word, and the sentence a card showed last.
//
// Everything stays on this device: the texts are read from Dexie, searched in memory and the
// result is only rendered. Nothing is written to a synced or shared table; the "shown last"
// row is a device-local meta row holding a hash of the sentence, never its text.
//
// Kept cheap: the texts are read once and the results are cached per word; any write to
// `texts` or `graded_bodies` (here or in another tab) clears both. Inside a Dexie transaction
// only a function that has just awaited a Dexie request may be awaited, so a cache hit is
// returned synchronously and the loader is awaited only on a miss (as data/newOrder.ts does).
import Dexie from 'dexie';
import type { LastShown, SearchableText, TextSentence } from '../domain/textSentences';
import { findTextSentences } from '../domain/textSentences';
import type { Id } from '../domain/types';
import { db } from './db';
import { setMeta } from './meta';

/** Meta key prefix of the sentence a card showed last ({reps, key}). Device-local. */
export const LAST_SHOWN_PREFIX = 'example_last:';
export const lastShownKey = (cardId: Id): string => `${LAST_SHOWN_PREFIX}${cardId}`;

/** Tables the lookups read (add them to the caller's transaction). */
export const textSentenceTables = () => [db.texts, db.graded_bodies, db.meta];

let texts: SearchableText[] | null = null;
const results = new Map<string, TextSentence[]>();
let listening = false;

function listen(): void {
  if (listening) return;
  listening = true;
  Dexie.on('storagemutated', (parts) => {
    if (Object.keys(parts).some((k) => /\/(texts|graded_bodies)\//.test(k))) {
      texts = null;
      results.clear();
    }
  });
}

/** Tests only. */
export function resetTextSentenceCache(): void {
  texts = null;
  results.clear();
}

async function loadTexts(): Promise<SearchableText[]> {
  const rows = (await db.texts.toArray())
    .filter((t) => t.deleted_at === null)
    .sort((a, b) => b.updated_at - a.updated_at || (a.id < b.id ? 1 : -1));
  const gradedIds = rows.filter((t) => t.kind === 'graded' && t.graded_id).map((t) => t.graded_id!);
  const bodies = gradedIds.length ? await db.graded_bodies.bulkGet(gradedIds) : [];
  const byId = new Map(bodies.filter((b) => !!b).map((b) => [b!.id, b!]));
  const out: SearchableText[] = [];
  for (const t of rows) {
    if (t.kind === 'graded') {
      const b = t.graded_id ? byId.get(t.graded_id) : undefined;
      if (b) out.push({ id: t.id, sentences: b.sentences.map((s) => ({ en: s.en, tr: s.tr || null })) });
    } else if (t.body) out.push({ id: t.id, body: t.body });
  }
  return out;
}

const resultKey = (term: string, pos: string | null, exclude: string | null) => `${term}\u0000${pos ?? ''}\u0000${exclude ?? ''}`;

/** Cached sentences for a word, or undefined when they still have to be searched. */
export function cachedTextSentences(term: string, pos: string | null, exclude: string | null): TextSentence[] | undefined {
  return texts ? results.get(resultKey(term, pos, exclude)) : undefined;
}

/** Searches the user's texts for the word (newest text first). Await only on a cache miss. */
export async function loadTextSentences(term: string, pos: string | null, exclude: string | null): Promise<TextSentence[]> {
  listen();
  if (!texts) {
    texts = await loadTexts();
    results.clear();
  }
  const found = findTextSentences(texts, term, { pos, exclude: [exclude] });
  results.set(resultKey(term, pos, exclude), found);
  return found;
}

/** The sentence a card showed last (meta), null when none or unreadable. */
export async function readLastShown(cardId: Id): Promise<LastShown | null> {
  const v = (await db.meta.get(lastShownKey(cardId)))?.value as Partial<LastShown> | undefined;
  return v && typeof v.reps === 'number' && typeof v.key === 'string' ? { reps: v.reps, key: v.key } : null;
}

/** Remember the sentence a card shows now (after the view's read transaction). */
export async function writeLastShown(cardId: Id, shown: LastShown): Promise<void> {
  await setMeta(lastShownKey(cardId), shown);
}
