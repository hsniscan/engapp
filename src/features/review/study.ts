// Non-component helpers of the study session (redesign): labels, previews, the cloze choice
// pool, and session facts. Kept apart from the component files for fast refresh.
import { useTranslation } from 'react-i18next';
import { type CardView, getChoiceCandidates, logError } from '@/data';
import type { ChoiceCandidate } from '@/domain/clozeChoices';
import { formatNextInterval, type IntervalPreview } from '@/domain/fsrs';
import { findSpan, isValidSpan } from '@/domain/recognition';
import {
  cardStage,
  isRelearning,
  STAGE_LABEL_TR,
  stageChangeLabel,
  stageProgress,
  type WordStage,
} from '@/domain/stages';
import { studyModeOf } from '@/domain/studyMode';
import { type Card, type Id, Rating as R, type RatingValue, type Sense } from '@/domain/types';
import type { Rating } from '@/ui';
import { productionAnswerMode } from './answerMode';
import { modeText } from './modeText';
import type { SessionAnswer } from './useReviewSession';

export const meaningOf = (s: Pick<Sense, 'meaning_tr' | 'meaning_tr_override'>) =>
  s.meaning_tr_override ?? s.meaning_tr;

export const ratingValue: Record<Rating, RatingValue> = {
  again: R.Again,
  hard: R.Hard,
  good: R.Good,
  easy: R.Easy,
};

/** The stage after this answer, when the scheduler preview knows it (learning-model branch). */
export function stageAfterOf(p: IntervalPreview): WordStage | null {
  return (p as IntervalPreview & { stageAfter?: WordStage }).stageAfter ?? null;
}

/** Under a rating button: "yarın", and "↑ Öğrenildi" when the answer changes the stage. */
export function ratingLines(
  view: CardView,
  rating: RatingValue,
): { interval: string; change: string | null } {
  const p = view.previews[rating];
  const after = stageAfterOf(p);
  return {
    interval: formatNextInterval(p.interval_ms),
    change: after ? stageChangeLabel(cardStage(view.card), after) : null,
  };
}

/** "Yeni kelime", "Öğreniyor", "Yeniden öğreniyor", "Pekişiyor · 1/3", "Öğrenildi", "Kalıcı". */
export function stageChipLabel(
  card: Card,
  t: (k: 'study.stage.newWord' | 'study.stage.relearning') => string,
): string {
  const stage = cardStage(card);
  if (stage === 'new') return t('study.stage.newWord');
  if (stage === 'learning' && isRelearning(card)) return t('study.stage.relearning');
  if (stage === 'consolidating') {
    const p = stageProgress(card);
    return `${STAGE_LABEL_TR.consolidating} · ${p.step}/${p.of}`;
  }
  return STAGE_LABEL_TR[stage];
}

/** "Kelime çalışma · İngilizce → Türkçe" on the front, the mode alone on the back. */
export function useModeLabel(view: CardView, withDirection: boolean): string {
  const { t } = useTranslation();
  const mode = studyModeOf(view.card.card_type);
  if (view.note.term_type === 'contrast') return t('leech.contrast.prompt');
  const name = modeText(t, mode, 'name');
  return withDirection && mode !== 'cloze' ? `${name} · ${modeText(t, mode, 'dir')}` : name;
}

/** Where the term sits in the card's sentence (stored span, else a text search). */
export function blankSpan(view: CardView): [number, number] | null {
  const s = view.sentence;
  if (!s) return null;
  return s.span && isValidSpan(s.text, s.span) ? s.span : findSpan(s.text, view.note.term);
}

/** Card types whose answer is shown with Space (the others are typed or chosen). */
export const flipsWithSpace = (view: CardView) =>
  view.card.card_type === 'recognition' ||
  view.note.term_type === 'contrast' ||
  (view.card.card_type === 'cloze' && !view.cloze) ||
  // Üretim "aklımdan" (v0.5 İP9): no typing, the answer is shown.
  ((view.card.card_type === 'production' || view.card.card_type === 'image') &&
    productionAnswerMode() === 'flip');

/** Recognition answers of this session that moved a word to Öğrenildi or Kalıcı. */
export function learnedInSession(answers: readonly SessionAnswer[]): number {
  const reached = new Set<Id>();
  const high = (s: WordStage | null) => s === 'learned' || s === 'mastered';
  for (const a of answers) {
    if (a.view.card.card_type !== 'recognition') continue;
    if (!high(cardStage(a.view.card)) && high(stageAfterOf(a.view.previews[a.rating])))
      reached.add(a.view.note.id);
  }
  return reached.size;
}

// ------------------------------------------------------------------ cloze choices

let candidates: Promise<ChoiceCandidate[]> | null = null;

/** Read the distractor pool again (a new session: words may have been added). */
export function resetChoiceCandidates() {
  candidates = null;
}

export function loadChoiceCandidates(): Promise<ChoiceCandidate[]> {
  candidates ??= getChoiceCandidates().catch((e: unknown) => {
    void logError(e, 'study:choices');
    return [];
  });
  return candidates;
}
