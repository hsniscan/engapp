// Word stage counts (ADR 0041): "Öğrendiğin kelime", Kalıcı, Aktif, "Zaten bildiğin kelimeler".
import { countWordStages, type WordStageCounts } from '../domain/wordStages';
import type { Millis } from '../domain/types';
import { db } from './db';

export type { WordStageCounts };

/** Stage counts of the user's words. Safe to wrap in useLiveQuery. */
export async function getWordStages(now: Millis = Date.now()): Promise<WordStageCounts> {
  return db.transaction('r', [db.notes, db.cards, db.known_terms], async () => {
    const [notes, cards, known] = await Promise.all([db.notes.toArray(), db.cards.toArray(), db.known_terms.toArray()]);
    return countWordStages(notes, cards, known, now);
  });
}
