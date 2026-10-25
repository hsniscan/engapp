// STUB (agent C): the learning-model branch owns this file and its version wins at merge.
// Same exports and signatures as agreed: WordStage, STAGE_LABEL_TR, cardStage, stageProgress,
// isRelearning, stageLevel, stageChangeLabel.
import { type Card, CardState, type Millis } from './types';

export type WordStage = 'new' | 'learning' | 'consolidating' | 'learned' | 'mastered';

export const STAGE_LABEL_TR: Record<WordStage, string> = {
  new: 'Yeni',
  learning: 'Öğreniyor',
  consolidating: 'Pekişiyor',
  learned: 'Öğrenildi',
  mastered: 'Kalıcı',
};

type StageCard = Pick<Card, 'state' | 'stability'> & { ramp_step?: number };

const rampOf = (c: StageCard): number => c.ramp_step ?? 0;

export function cardStage(card: StageCard, _now?: Date | Millis): WordStage {
  if (card.state === CardState.New) return 'new';
  if (card.state !== CardState.Review) return 'learning';
  const ramp = rampOf(card);
  if (ramp === 0) return 'learning';
  if (ramp < 3 || card.stability < 14) return 'consolidating';
  if (ramp >= 5 && card.stability >= 90) return 'mastered';
  return 'learned';
}

export function stageProgress(card: StageCard): { step: number; of: number } {
  const stage = cardStage(card);
  if (stage === 'consolidating') return { step: Math.min(rampOf(card), 2), of: 3 };
  if (stage === 'learned' || stage === 'mastered') return { step: 3, of: 3 };
  return { step: 0, of: 3 };
}

export function isRelearning(card: Pick<Card, 'state'>): boolean {
  return card.state === CardState.Relearning;
}

/** 0..4: how many of the 4 bar segments are filled. */
export function stageLevel(stage: WordStage): number {
  return { new: 0, learning: 1, consolidating: 2, learned: 3, mastered: 4 }[stage];
}

export function stageChangeLabel(from: WordStage, to: WordStage): string | null {
  if (from === to) return null;
  if (stageLevel(to) < stageLevel(from)) return '↓ yeniden öğren';
  if (to === 'consolidating' || to === 'learned' || to === 'mastered')
    return `↑ ${STAGE_LABEL_TR[to]}`;
  return null;
}
