// STUB (agent D, redesign): the shared signature from the implementation brief, so the Desteler
// screens compile before the learning-model agent lands the real module. The owner's version
// (counting "sağlam tekrar" per docs/plan ogrenme-modeli §2) replaces this file at merge.
import { type Card, CardState } from './types';

export type WordStage = 'new' | 'learning' | 'consolidating' | 'learned' | 'mastered';

export const STAGE_LABEL_TR: Record<WordStage, string> = {
  new: 'Yeni',
  learning: 'Öğreniyor',
  consolidating: 'Pekişiyor',
  learned: 'Öğrenildi',
  mastered: 'Kalıcı',
};

/** Approximation until the real counter exists: by state and memory strength (days). */
export function cardStage(card: Card, _now?: Date): WordStage {
  if (card.state === CardState.New) return 'new';
  if (card.state !== CardState.Review) return 'learning';
  if (card.stability >= 90 && card.reps >= 5) return 'mastered';
  if (card.stability >= 14 && card.reps >= 3) return 'learned';
  return 'consolidating';
}

export function stageProgress(card: Card): { step: number; of: number } {
  const stage = cardStage(card);
  if (stage === 'consolidating') return { step: Math.min(2, Math.max(1, card.reps - 1)), of: 3 };
  return { step: 0, of: 0 };
}
