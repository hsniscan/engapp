import { useLiveQuery } from 'dexie-react-hooks';
import { getWordStages } from '@/data';

export interface WordStagesView {
  learning: number;
  consolidating: number;
  learned: number;
  mastered: number;
  /** learned + mastered (recognition cards, words only). */
  learnedTotal: number;
  /** learnedTotal gained in the last 7 days (first time Öğrenildi). */
  weekDelta: number;
  /** Words whose production card is learned or mastered ("Aktif"). */
  active: number;
  /** Marked "Biliyorum"; never part of learnedTotal. */
  alreadyKnown: number;
}

/** Live word-stage counts (ADR 0041); undefined while loading. */
export function useWordStages(): WordStagesView | undefined {
  return useLiveQuery(async () => {
    const c = await getWordStages(Date.now());
    return {
      learning: c.learning,
      consolidating: c.consolidating,
      learned: c.learned,
      mastered: c.mastered,
      learnedTotal: c.learnedTotal,
      weekDelta: c.weekDelta,
      active: c.active,
      alreadyKnown: c.alreadyKnown,
    };
  }, []);
}

/** Alias kept for callers written against the stub. */
export type WordStageCounts = WordStagesView;
