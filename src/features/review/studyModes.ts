// Study modes for screens (redesign): what each of "Kelime çalışma", "Üretim" and "Boşluk
// doldurma" has left today, for the StudyModes picker and the home screen.
import { useLiveQuery } from 'dexie-react-hooks';
import { getStudyQueue, type StudyQueue } from '@/data';
import { STUDY_MODES, type StudyMode } from '@/domain/studyMode';
import type { Millis } from '@/domain/types';

export type { StudyMode } from '@/domain/studyMode';
export { STUDY_MODES, isStudyMode, studyModeOf, STUDY_MODE_CARD_TYPES } from '@/domain/studyMode';

export interface StudyModeCount {
  /** Learning steps and reviews due today. */
  due: number;
  /** First-time cards the mode's daily limit still allows. */
  newCount: number;
  /** Minutes the remaining cards take at the user's pace (rounded up, 0 when nothing is left). */
  estMinutes: number;
}

/** Seconds per answer when there is no history yet (domain/capacity default pace). */
const FALLBACK_SEC_PER_CARD = 10;

export function countOf(q: Pick<StudyQueue, 'counts' | 'load'>): StudyModeCount {
  const due = q.counts.learning + q.counts.review;
  const total = due + q.counts.new;
  const sec = q.load?.secPerCard ?? FALLBACK_SEC_PER_CARD;
  return {
    due,
    newCount: q.counts.new,
    estMinutes: total ? Math.max(1, Math.ceil((total * sec) / 60)) : 0,
  };
}

export async function getStudyModeCounts(
  now: Millis = Date.now(),
): Promise<Record<StudyMode, StudyModeCount>> {
  const queues = await Promise.all(
    STUDY_MODES.map((studyMode) => getStudyQueue({ studyMode, learnAheadMs: 0 }, now)),
  );
  return Object.fromEntries(STUDY_MODES.map((m, i) => [m, countOf(queues[i]!)])) as Record<
    StudyMode,
    StudyModeCount
  >;
}

/** Live counts per study mode; undefined while loading. */
export function useStudyModeCounts(): Record<StudyMode, StudyModeCount> | undefined {
  return useLiveQuery(() => getStudyModeCounts(), []);
}
