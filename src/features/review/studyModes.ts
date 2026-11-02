// Study modes for screens (redesign): what each of "Kelime çalışma", "Üretim", "Boşluk
// doldurma" and "Dikte" has left today, and the day as a whole (domain/studyPlan.ts, ADR 0055).
// Bugün, the Çalış picker, the mixed session and "Biraz daha çalış" all read these numbers.
//
// v0.5.2 (ADR 0062): one shared read for every mode (getStudyQueues), learning steps due later
// today count as today's work ("5 kart 10 dk sonra", never "Bugünlük tamam" while they wait),
// and the numbers are recomputed when a step falls due, at the day change and on resume.
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getStudyQueues, type StudyQueue } from '@/data';
import { dictationAvailable } from '@/data/dictation';
import { STUDY_MODE_CARD_TYPES, STUDY_MODES, type StudyMode } from '@/domain/studyMode';
import { type ModeLeft, minutesFor, answersLeft, planToday, type TodayPlan } from '@/domain/studyPlan';
import { DEFAULT_LEARN_AHEAD_MS } from '@/domain/queue';
import type { Millis } from '@/domain/types';
import { useStudyTick } from './studyClock';

export type { StudyMode } from '@/domain/studyMode';
export { STUDY_MODES, isStudyMode, studyModeOf, STUDY_MODE_CARD_TYPES } from '@/domain/studyMode';

export interface StudyModeCount {
  /** Learning steps due now (learn-ahead included) and reviews due today. */
  due: number;
  /** First-time cards the mode's share of today's budget still allows. */
  newCount: number;
  /** Learning steps due later today: today's work, not yet studiable. */
  later: number;
  /** The same split for the estimate (domain/studyPlan.ts); learning counts the later steps too. */
  left: ModeLeft;
  /** Minutes the remaining cards take at the user's pace, learning steps included. */
  estMinutes: number;
  /** Reviews due today that catch-up moved to later days ("ertelendi", not "bitti"). */
  deferred: number;
}

/** Seconds per answer when there is no history yet (domain/capacity default pace). */
const FALLBACK_SEC_PER_CARD = 10;

const secOf = (q: Pick<StudyQueue, 'load'>) => q.load?.secPerCard ?? FALLBACK_SEC_PER_CARD;

export function countOf(
  q: Pick<StudyQueue, 'counts' | 'load'> & Partial<Pick<StudyQueue, 'learningLater' | 'deferred'>>,
): StudyModeCount {
  const later = q.learningLater?.length ?? 0;
  const left: ModeLeft = { review: q.counts.review, learning: q.counts.learning + later, fresh: q.counts.new };
  return {
    due: q.counts.learning + q.counts.review,
    newCount: q.counts.new,
    later,
    left,
    estMinutes: minutesFor(answersLeft(left), secOf(q)),
    deferred: q.deferred ?? 0,
  };
}

/** Cards a mode can study right now. */
export const modeLeft = (c: StudyModeCount): number => c.due + c.newCount;
/** Cards left in a mode today, the learning steps that wait included. */
export const modeLeftToday = (c: StudyModeCount): number => c.due + c.newCount + c.later;

export interface TodayStudy extends TodayPlan {
  counts: Record<StudyMode, StudyModeCount>;
  /** The modes this device can study (Dikte only with sentences to read). */
  modes: StudyMode[];
  dictation: boolean;
  /** Cards studiable now over the modes shown (`left` also holds the steps that wait). */
  ready: number;
  /** Learning steps due later today over the modes shown. */
  later: number;
  /** First mode with cards studiable now (null: none now; see `later`). */
  nextReady: StudyMode | null;
  /** When the earliest waiting learning step falls due (null: none today). */
  nextLearningDue: Millis | null;
  /** Exclusive end of the study day. */
  dayEnd: Millis;
  /** Cards answered today that are done for today (the ring counts cards, not answers). */
  doneCards: number;
  /** Modes with no unlocked card at all yet (Üretim / Boşluk open at Pekişiyor). */
  locked: StudyMode[];
}

/** Modes whose card types have no live, unlocked card yet (walks only until the first one). */
async function lockedModes(modes: readonly StudyMode[]): Promise<StudyMode[]> {
  const out: StudyMode[] = [];
  for (const m of modes) {
    if (m === 'word') continue;
    const any = await db.cards
      .where('card_type')
      .anyOf([...STUDY_MODE_CARD_TYPES[m]])
      .filter((c) => c.deleted_at === null && c.unlocked)
      .first();
    if (!any) out.push(m);
  }
  return out;
}

export async function getTodayStudy(now: Millis = Date.now()): Promise<TodayStudy> {
  const [queues, dictation] = await Promise.all([getStudyQueues({}, now), dictationAvailable()]);
  const counts = Object.fromEntries(STUDY_MODES.map((m) => [m, countOf(queues[m])])) as Record<
    StudyMode,
    StudyModeCount
  >;
  const modes = STUDY_MODES.filter((m) => m !== 'dictation' || dictation || modeLeftToday(counts[m]) > 0);
  const plan = planToday(
    Object.fromEntries(modes.map((m) => [m, counts[m].left])),
    secOf(queues.word),
  );
  let doneCards = 0;
  let nextLearningDue: Millis | null = null;
  for (const m of modes) {
    const q = queues[m];
    const left = new Set([...q.items.map((i) => i.card_id), ...q.learningLater]);
    doneCards += q.answeredToday.filter((id) => !left.has(id)).length;
    if (q.nextLearningDue !== null && (nextLearningDue === null || q.nextLearningDue < nextLearningDue))
      nextLearningDue = q.nextLearningDue;
  }
  const idle = modes.filter((m) => modeLeftToday(counts[m]) === 0);
  const locked = idle.length ? await lockedModes(idle) : [];
  return {
    ...plan,
    counts,
    modes,
    dictation: modes.includes('dictation'),
    ready: modes.reduce((n, m) => n + modeLeft(counts[m]), 0),
    later: modes.reduce((n, m) => n + counts[m].later, 0),
    nextReady: modes.find((m) => modeLeft(counts[m]) > 0) ?? null,
    nextLearningDue,
    dayEnd: queues.word.dayEnd,
    doneCards,
    locked,
  };
}

/**
 * Today's study per mode and in total; undefined while loading. Recomputed after every write,
 * when the next learning step falls due, at the day change and when the app comes back.
 */
export function useTodayStudy(): TodayStudy | undefined {
  const [wake, setWake] = useState<readonly (number | null)[]>([]);
  const tick = useStudyTick(wake);
  const study = useLiveQuery(() => getTodayStudy(), [tick]);
  // The session shows a step DEFAULT_LEARN_AHEAD_MS early, so Bugün turns ready then too.
  const nextWake = study
    ? [study.nextLearningDue === null ? null : study.nextLearningDue - DEFAULT_LEARN_AHEAD_MS, study.dayEnd]
    : [];
  if (nextWake.join(',') !== wake.join(',')) setWake(nextWake);
  return study;
}
