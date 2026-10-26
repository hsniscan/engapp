// Word stage counts (ADR 0041): "Öğrendiğin kelime", Kalıcı, Aktif, "Zaten bildiğin kelimeler".
import { cardStageDistribution, countWordStages, type WordStageCounts } from '../domain/wordStages';
import type { WordStage } from '../domain/stages';
import type { CardType, Millis } from '../domain/types';
import { db } from './db';

export type { WordStageCounts };

/** Stage counts of the user's words. Safe to wrap in useLiveQuery. */
export async function getWordStages(now: Millis = Date.now()): Promise<WordStageCounts> {
  return db.transaction('r', [db.notes, db.cards, db.known_terms], async () => {
    const [notes, cards, known] = await Promise.all([db.notes.toArray(), db.cards.toArray(), db.known_terms.toArray()]);
    return countWordStages(notes, cards, known, now);
  });
}

export type StageMode = 'word' | 'production' | 'cloze';

/** Card types of each study mode (word = recognition; production includes picture cards). */
export const MODE_CARD_TYPES: Record<StageMode, readonly CardType[]> = {
  word: ['recognition'],
  production: ['production', 'image'],
  cloze: ['cloze'],
};

/** Stage distribution per study mode (İlerleme: one bar per mode). Locked cards are left out. */
export async function getStageDistribution(): Promise<Record<StageMode, Record<WordStage, number>>> {
  const cards = await db.cards.toArray();
  return {
    word: cardStageDistribution(cards, MODE_CARD_TYPES.word),
    production: cardStageDistribution(cards, MODE_CARD_TYPES.production),
    cloze: cardStageDistribution(cards, MODE_CARD_TYPES.cloze),
  };
}
