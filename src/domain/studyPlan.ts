// Today's study across the modes (v0.5.1, ADR 0055): one "remaining today" count and one time
// estimate for Bugün, the Çalış picker, the mixed session and "Biraz daha çalış", and the mode to
// study next. Pure.
//
// The estimate counts answers, not cards: a new card takes its learning steps on the first day
// (1 min → 10 min → graduate: about 2.5 answers with the usual Again/Good mix), a card in a
// learning step about 1.5 more, a due review one.
import { STUDY_MODES, type StudyMode } from './studyMode';

/** Answers a first-time card takes on its first day (learning steps included). */
export const ANSWERS_PER_NEW = 2.5;
/** Answers a card already in a (re)learning step still takes today. */
export const ANSWERS_PER_LEARNING = 1.5;

export interface ModeLeft {
  /** Reviews due today (Review state). */
  review: number;
  /** (Re)learning steps due today. */
  learning: number;
  /** First-time cards the mode's limit still allows today. */
  fresh: number;
}

/** Cards left in a mode today. */
export const cardsLeft = (m: ModeLeft): number => m.review + m.learning + m.fresh;

/** Answers the cards left will take, learning steps included. */
export function answersLeft(m: ModeLeft): number {
  return m.review + m.learning * ANSWERS_PER_LEARNING + m.fresh * ANSWERS_PER_NEW;
}

/** Minutes for `answers` answers at `secPerAnswer` (rounded up; 0 for none, else at least 1). */
export function minutesFor(answers: number, secPerAnswer: number): number {
  if (!(answers > 0)) return 0;
  return Math.max(1, Math.ceil((answers * secPerAnswer) / 60));
}

export interface TodayPlan {
  /** Cards left over every mode shown. */
  left: number;
  /** Minutes those cards take. */
  minutes: number;
  /** First mode (in STUDY_MODES order) with cards left, null when all are done. */
  next: StudyMode | null;
  /** Modes with cards left, in order. */
  waiting: StudyMode[];
}

/**
 * The day over the given modes (absent modes, such as Dikte without sentences on this device,
 * do not count). `order` defaults to the modes' own order: Kelime, Üretim, Boşluk, Dikte.
 */
export function planToday(
  modes: Partial<Record<StudyMode, ModeLeft>>,
  secPerAnswer: number,
  order: readonly StudyMode[] = STUDY_MODES,
): TodayPlan {
  let answers = 0;
  let left = 0;
  const waiting: StudyMode[] = [];
  for (const m of order) {
    const c = modes[m];
    if (!c) continue;
    answers += answersLeft(c);
    left += cardsLeft(c);
    if (cardsLeft(c) > 0) waiting.push(m);
  }
  return { left, minutes: minutesFor(answers, secPerAnswer), next: waiting[0] ?? null, waiting };
}

/**
 * Catch-up shared over the modes: the review cap is one budget for the day, not one per mode.
 * Earlier modes (STUDY_MODES order) take their due reviews first; `mode` gets what is left.
 * `dueReviews` = Review-state cards due today per mode. null cap = no cap.
 */
export function shareReviewCap(
  cap: number | null,
  dueReviews: Partial<Record<StudyMode, number>>,
  mode: StudyMode,
  order: readonly StudyMode[] = STUDY_MODES,
): number | null {
  if (cap === null) return null;
  let budget = Math.max(0, cap);
  for (const m of order) {
    if (m === mode) return budget;
    budget -= Math.min(budget, Math.max(0, dueReviews[m] ?? 0));
  }
  return budget;
}
