// Study modes for screens (redesign): what each of "Kelime çalışma", "Üretim", "Boşluk
// doldurma" and "Dikte" has left today, and the day as a whole (domain/studyPlan.ts, ADR 0055).
// Bugün, the Çalış picker, the mixed session and "Biraz daha çalış" all read these numbers.
import { useLiveQuery } from 'dexie-react-hooks';
import { getStudyQueue, type StudyQueue } from '@/data';
import { dictationAvailable } from '@/data/dictation';
import { STUDY_MODES, type StudyMode } from '@/domain/studyMode';
import { type ModeLeft, minutesFor, answersLeft, planToday, type TodayPlan } from '@/domain/studyPlan';
import type { Millis } from '@/domain/types';

export type { StudyMode } from '@/domain/studyMode';
export { STUDY_MODES, isStudyMode, studyModeOf, STUDY_MODE_CARD_TYPES } from '@/domain/studyMode';

export interface StudyModeCount {
  /** Learning steps and reviews due today. */
  due: number;
  /** First-time cards the mode's daily limit still allows. */
  newCount: number;
  /** The same split for the estimate (domain/studyPlan.ts). */
  left: ModeLeft;
  /** Minutes the remaining cards take at the user's pace, learning steps included. */
  estMinutes: number;
}

/** Seconds per answer when there is no history yet (domain/capacity default pace). */
const FALLBACK_SEC_PER_CARD = 10;

const secOf = (q: Pick<StudyQueue, 'load'>) => q.load?.secPerCard ?? FALLBACK_SEC_PER_CARD;

export function countOf(q: Pick<StudyQueue, 'counts' | 'load'>): StudyModeCount {
  const left: ModeLeft = { review: q.counts.review, learning: q.counts.learning, fresh: q.counts.new };
  return {
    due: q.counts.learning + q.counts.review,
    newCount: q.counts.new,
    left,
    estMinutes: minutesFor(answersLeft(left), secOf(q)),
  };
}

/** Cards left in one mode today. */
export const modeLeft = (c: StudyModeCount): number => c.due + c.newCount;

export interface TodayStudy extends TodayPlan {
  counts: Record<StudyMode, StudyModeCount>;
  /** The modes this device can study (Dikte only with sentences to read). */
  modes: StudyMode[];
  dictation: boolean;
}

export async function getTodayStudy(now: Millis = Date.now()): Promise<TodayStudy> {
  const [queues, dictation] = await Promise.all([
    Promise.all(STUDY_MODES.map((studyMode) => getStudyQueue({ studyMode, learnAheadMs: 0 }, now))),
    dictationAvailable(),
  ]);
  const counts = Object.fromEntries(STUDY_MODES.map((m, i) => [m, countOf(queues[i]!)])) as Record<
    StudyMode,
    StudyModeCount
  >;
  const modes = STUDY_MODES.filter((m) => m !== 'dictation' || dictation || modeLeft(counts[m]) > 0);
  const plan = planToday(
    Object.fromEntries(modes.map((m) => [m, counts[m].left])),
    secOf(queues[0]!),
  );
  return { ...plan, counts, modes, dictation: modes.includes('dictation') };
}

/** Today's study per mode and in total; undefined while loading. */
export function useTodayStudy(): TodayStudy | undefined {
  return useLiveQuery(() => getTodayStudy(), []);
}

export async function getStudyModeCounts(
  now: Millis = Date.now(),
): Promise<Record<StudyMode, StudyModeCount>> {
  return (await getTodayStudy(now)).counts;
}

/** Live counts per study mode; undefined while loading. */
export function useStudyModeCounts(): Record<StudyMode, StudyModeCount> | undefined {
  return useTodayStudy()?.counts;
}
