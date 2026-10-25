// Word stages of the learning model (docs/decisions/0041-learning-model.md). Pure.
//
//   Yeni        the card was never answered
//   Öğreniyor   in the learning steps, relearning after a lapse, or graduated but not yet
//               recalled on another day (ramp_step 0)
//   Pekişiyor   ramp_step 1–2, or ramp_step ≥ 3 while stability is still under 14 days
//   Öğrenildi   ramp_step ≥ 3 and stability ≥ 14 days (recalled on three separate days)
//   Kalıcı      ramp_step ≥ 5 and stability ≥ 90 days
//
// A word's stage is the stage of its recognition card; its production card gives the
// "Aktif" badge (learned or mastered). Cloze and picture cards never change a word's stage.
import { STAGE } from './fsrsConfig';
import { CardState, type FsrsFields } from './types';

export type WordStage = 'new' | 'learning' | 'consolidating' | 'learned' | 'mastered';

export const WORD_STAGES: readonly WordStage[] = ['new', 'learning', 'consolidating', 'learned', 'mastered'];

export const STAGE_LABEL_TR: Record<WordStage, string> = {
  new: 'Yeni',
  learning: 'Öğreniyor',
  consolidating: 'Pekişiyor',
  learned: 'Öğrenildi',
  mastered: 'Kalıcı',
};

/** The fields a stage depends on (a Card has them all). */
export type StageInput = Pick<FsrsFields, 'state' | 'ramp_step' | 'stability'>;

/**
 * Stage of one card. `now` is accepted for API stability and ignored: a stage depends only on
 * the card's state, not on how overdue it is.
 */
export function cardStage(card: StageInput, _now?: Date): WordStage {
  if (card.state === CardState.New) return 'new';
  if (card.state !== CardState.Review) return 'learning'; // Learning or Relearning
  const step = card.ramp_step ?? 0;
  if (step === 0) return 'learning';
  if (step < STAGE.learnedStep || card.stability < STAGE.learnedS) return 'consolidating';
  if (step >= STAGE.durableStep && card.stability >= STAGE.durableS) return 'mastered';
  return 'learned';
}

/** The card was forgotten and is in its relearning step ("Yeniden öğreniyor" on the chip). */
export function isRelearning(card: Pick<FsrsFields, 'state'>): boolean {
  return card.state === CardState.Relearning;
}

/** Learned or mastered: counts as "öğrendiğin kelime". */
export function isLearnedStage(stage: WordStage): boolean {
  return stage === 'learned' || stage === 'mastered';
}

/** Filled segments of the 4-part stage bar: new 0, learning 1, consolidating 2, learned 3, mastered 4. */
export function stageLevel(stage: WordStage): number {
  return WORD_STAGES.indexOf(stage);
}

/**
 * Progress towards Öğrenildi in counted reviews, for the chip ("Pekişiyor · 2/3").
 * consolidating: min(ramp_step, 2) of 3; new/learning: 0 of 3; learned/mastered: 3 of 3.
 */
export function stageProgress(card: StageInput): { step: number; of: number } {
  const of = STAGE.learnedStep;
  const stage = cardStage(card);
  if (stage === 'consolidating') return { step: Math.min(card.ramp_step ?? 0, of - 1), of };
  if (isLearnedStage(stage)) return { step: of, of };
  return { step: 0, of };
}

/**
 * Second line under an answer button when the answer changes the stage: "↑ Pekişiyor",
 * "↑ Öğrenildi", "↑ Kalıcı" when it rises, "↓ yeniden öğren" when it falls; null otherwise.
 */
export function stageChangeLabel(from: WordStage, to: WordStage): string | null {
  const a = stageLevel(from);
  const b = stageLevel(to);
  if (a === b) return null;
  if (b > a) return to === 'learning' ? null : `↑ ${STAGE_LABEL_TR[to]}`;
  return '↓ yeniden öğren';
}

/**
 * The answer made the card Öğrenildi for the first time (session summary: "Bugün 3 kelime
 * Öğrenildi'ye geçti"; count recognition cards only).
 */
export function becameLearned(before: Pick<FsrsFields, 'learned_at'>, after: Pick<FsrsFields, 'learned_at'>): boolean {
  return (before.learned_at ?? null) === null && (after.learned_at ?? null) !== null;
}
