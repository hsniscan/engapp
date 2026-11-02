// Non-component helpers of the study session (redesign): labels, previews, the cloze choice
// pool, and session facts. Kept apart from the component files for fast refresh.
import { useTranslation } from 'react-i18next';
import { type CardView, getChoiceCandidates, logError } from '@/data';
import type { ChoiceCandidate } from '@/domain/clozeChoices';
import type { TFunction } from 'i18next';
import { distinctIntervalParts, type IntervalPreview } from '@/domain/fsrs';
import { intervalText } from './intervalText';
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
import { type Card, CardState, type Id, Rating as R, type RatingValue, type Sense } from '@/domain/types';
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
  t: TFunction,
): { interval: string; change: string | null } {
  const p = view.previews[rating];
  const after = stageAfterOf(p);
  const order = [R.Again, R.Hard, R.Good, R.Easy] as const;
  const labels = distinctIntervalParts(order.map((r) => view.previews[r].interval_ms));
  const label = labels[order.indexOf(rating as (typeof order)[number])];
  return {
    interval: label ? intervalText(t, label) : '',
    change: after ? stageChangeLabel(cardStage(view.card), after) : null,
  };
}

/**
 * "Yeni kelime", "Öğreniyor", "Yeniden öğreniyor", "Pekişiyor · 1/3", "Öğrenildi", "Kalıcı".
 * A first-time Üretim / Boşluk / Dikte / picture card says "Yeni kart": its word is not new
 * (it opened at Pekişiyor; v0.5.2, review copy 1).
 */
export function stageChipLabel(
  card: Card,
  t: (k: 'study.stage.newWord' | 'study.stage.newCard' | 'study.stage.relearning') => string,
): string {
  const stage = cardStage(card);
  if (stage === 'new') return t(card.card_type === 'recognition' ? 'study.stage.newWord' : 'study.stage.newCard');
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

/** Words of the session, words that reached Pekişiyor or higher, and recall on reviews. */
export function sessionFacts(answers: readonly SessionAnswer[]): {
  words: number;
  consolidated: number;
  reviews: number;
  recalled: number;
} {
  const words = new Set<Id>();
  const up = new Set<Id>();
  const rank = { new: 0, learning: 1, consolidating: 2, learned: 3, mastered: 4 } as const;
  let reviews = 0;
  let recalled = 0;
  for (const a of answers) {
    words.add(a.view.note.id);
    const before = cardStage(a.view.card);
    const after = stageAfterOf(a.view.previews[a.rating]);
    if (after && rank[before] < rank.consolidating && rank[after] >= rank.consolidating)
      up.add(a.view.note.id);
    // Recall counts answers on cards that were in review; learning steps of new words do not.
    if (a.view.card.state === CardState.Review) {
      reviews++;
      if (a.rating !== R.Again) recalled++;
    }
  }
  return { words: words.size, consolidated: up.size, reviews, recalled };
}

const STAGE_RANK: Record<WordStage, number> = {
  new: 0,
  learning: 1,
  consolidating: 2,
  learned: 3,
  mastered: 4,
};

export interface StageChange {
  noteId: Id;
  term: string;
  /** The word's stage before its first answer in this session. */
  from: WordStage;
  /** The stage after its last answer in this session. */
  to: WordStage;
}

/**
 * Words whose stage went up in this session ("Aşama değişenler" on the summary). The word's
 * stage is its recognition card's (ADR 0041), so only those answers count; a word that went up
 * and came back down is left out. Order: first answered first.
 */
export function stageChanges(answers: readonly SessionAnswer[]): StageChange[] {
  const byNote = new Map<Id, StageChange>();
  for (const a of answers) {
    if (a.view.card.card_type !== 'recognition') continue;
    const before = cardStage(a.view.card);
    const after = stageAfterOf(a.view.previews[a.rating]) ?? before;
    const seen = byNote.get(a.view.note.id);
    if (!seen) byNote.set(a.view.note.id, { noteId: a.view.note.id, term: a.view.note.term, from: before, to: after });
    else seen.to = after;
  }
  return [...byNote.values()].filter((c) => STAGE_RANK[c.to] > STAGE_RANK[c.from]);
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
