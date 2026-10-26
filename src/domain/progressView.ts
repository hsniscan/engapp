// Small display rules for İlerleme and Profil (v0.5.1 "Toparlama", ADR 0058). Pure.
//
// - Progressive İlerleme: below FIRST_STEPS_ANSWERS a new user sees one "İlk çalışmanı yap"
//   card and the calendar; the other panels open as data arrives, and the page says when.
// - No call to action when there is nothing to do: practice over 0 hard words, a gap practice
//   when both directions are equal, "Sınırı N yap" when the limit is already N or lower.
// - A floor for the vocabulary size before any test: the words the user has learned or marked.

/** Answers before İlerleme shows more than the first-steps card and the calendar. */
export const FIRST_STEPS_ANSWERS = 10;
/** Answers in the last 30 days before the recall rate is shown (domain/streak.ts). */
export const RECALL_MIN_ANSWERS = 20;
/** Answers in each direction before the recognition–production comparison (retention.ts). */
export const GAP_MIN_ANSWERS = 20;

export function isProgressBeginner(totalAnswers: number): boolean {
  return totalAnswers < FIRST_STEPS_ANSWERS;
}

/** Things İlerleme will show later and the condition that opens each. */
export type UnlockKey = 'stages' | 'recall' | 'gap' | 'report';

export interface UnlockInfo {
  key: UnlockKey;
  /** Already open. */
  open: boolean;
  /** How many more answers (stages, recall, gap) or 0 for the report (opens on Monday). */
  remaining: number;
}

export function progressUnlocks(input: {
  totalAnswers: number;
  last30Answers: number;
  recognitionAnswers: number;
  productionAnswers: number;
  hasReport: boolean;
}): UnlockInfo[] {
  const left = (need: number, have: number) => Math.max(0, need - have);
  return [
    {
      key: 'stages',
      open: !isProgressBeginner(input.totalAnswers),
      remaining: left(FIRST_STEPS_ANSWERS, input.totalAnswers),
    },
    {
      key: 'recall',
      open: input.last30Answers >= RECALL_MIN_ANSWERS,
      remaining: left(RECALL_MIN_ANSWERS, input.last30Answers),
    },
    {
      key: 'gap',
      open:
        input.recognitionAnswers >= GAP_MIN_ANSWERS && input.productionAnswers >= GAP_MIN_ANSWERS,
      remaining: Math.max(
        left(GAP_MIN_ANSWERS, input.recognitionAnswers),
        left(GAP_MIN_ANSWERS, input.productionAnswers),
      ),
    },
    { key: 'report', open: input.hasReport, remaining: 0 },
  ];
}

/**
 * Offer the "biggest gaps" practice only when there are words to practise and English → Turkish
 * is really ahead of Turkish → English (as the user reads it: whole percents). Equal or reversed
 * rates: no nudge.
 */
export function shouldNudgeGap(gap: {
  recognitionRate: number | null;
  productionRate: number | null;
  noteCount: number;
}): boolean {
  if (gap.noteCount === 0) return false;
  if (gap.recognitionRate === null || gap.productionRate === null) return true;
  return Math.round(gap.recognitionRate * 100) > Math.round(gap.productionRate * 100);
}

/** The weekly report's "Sınırı N yap": only when it would lower the limit. */
export function newLimitAction(
  current: number | undefined,
  suggested: number,
): 'lower' | 'done' | 'already' | null {
  if (current === undefined) return null;
  if (current > suggested) return 'lower';
  return current === suggested ? 'done' : 'already';
}

/**
 * The vocabulary floor shown before any level test: words learned in the app plus words marked
 * "Biliyorum". Null when there is nothing to count.
 */
export function vocabularyFloor(learnedWords: number, knownWords: number): number | null {
  const n = Math.max(0, learnedWords) + Math.max(0, knownWords);
  return n > 0 ? n : null;
}
