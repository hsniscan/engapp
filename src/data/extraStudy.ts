// "Biraz daha çalış": what is left to do once today's queue is empty.
//   - extra new cards: a per-day, per-mode allowance on top of the mode's share of the day's
//     budget, stored in this device's meta (`extra_new:<day>`; v0.5.2 per mode, ADR 0062). Cards introduced today are counted from the review logs, so a
//     second device never introduces them twice; it just does not know about the allowance.
//   - review ahead: tomorrow's reviews through the normal answer path (getStudyQueue 'ahead').
//   - practice: see data/practice.ts.
import { dayKeyOf } from '../domain/day';
import { isStudyMode, STUDY_MODES, type StudyMode } from '../domain/studyMode';
import type { Millis } from '../domain/types';
import { db } from './db';
import { ActionError } from './errors';
import { EXTRA_NEW_PREFIX, extraNewKey, setMeta } from './meta';
import { getPracticeSourceCounts, type PracticeSourceCounts } from './practice';
import { getExtraNewToday, getStudyQueue, getStudyQueues } from './queries';
import { dayConfig, getSettings } from './settings';

/** Largest single extra step the UI offers is 10; this only guards against nonsense. */
export const MAX_EXTRA_NEW_STEP = 100;

/**
 * Allow `n` more new cards of one study mode today (on this device). Returns that mode's total
 * extra allowance today. Allowances of other days are removed.
 */
export async function addExtraNew(n: number, mode: StudyMode = 'word', now: Millis = Date.now()): Promise<number> {
  if (!Number.isInteger(n) || n < 1 || n > MAX_EXTRA_NEW_STEP)
    throw new ActionError('invalid_input', 'Invalid extra count');
  if (!isStudyMode(mode)) throw new ActionError('invalid_input', 'Invalid study mode');
  return db.transaction('rw', [db.meta, db.settings], async () => {
    const settings = await getSettings(now);
    const day = dayKeyOf(now, dayConfig(settings));
    const extra = await getExtraNewToday(day);
    extra[mode] += n;
    const stale = (await db.meta.where('key').startsWith(EXTRA_NEW_PREFIX).primaryKeys()).filter(
      (k) => k !== extraNewKey(day),
    );
    await db.meta.bulkDelete(stale);
    await setMeta(extraNewKey(day), extra);
    return extra[mode];
  });
}

export interface MoreStudyOverview {
  dailyNewLimit: number;
  /** Today's extra allowance over every mode. */
  extraNewToday: number;
  /** First-time cards still waiting beyond today's allowance, over every mode. */
  newWaiting: number;
  /** The same per mode. */
  newWaitingByMode: Record<StudyMode, number>;
  /** The mode "+5 yeni kart" adds to: the one with the most waiting cards (Kelime on a tie). */
  extraMode: StudyMode | null;
  /** Catch-up, a vacation or the ramp after one pauses new cards today (no "+5" then). */
  newPaused: boolean;
  /** Tomorrow's reviews that can be done now ("Yarının kartları"): what that session holds. */
  aheadCount: number;
  practice: PracticeSourceCounts;
}

export async function getMoreStudyOverview(now: Millis = Date.now()): Promise<MoreStudyOverview> {
  const [queues, ahead, practice, settings] = await Promise.all([
    getStudyQueues({ learnAheadMs: 0 }, now),
    getStudyQueue({ mode: 'ahead', learnAheadMs: 0 }, now),
    getPracticeSourceCounts(now),
    getSettings(now),
  ]);
  const byMode = Object.fromEntries(STUDY_MODES.map((m) => [m, queues[m].newWaiting])) as Record<StudyMode, number>;
  let extraMode: StudyMode | null = null;
  for (const m of STUDY_MODES) if (byMode[m] > 0 && (extraMode === null || byMode[m] > byMode[extraMode])) extraMode = m;
  const load = queues.word.load;
  return {
    dailyNewLimit: settings.daily_new_limit,
    extraNewToday: STUDY_MODES.reduce((n, m) => n + queues[m].extraNewToday, 0),
    newWaiting: STUDY_MODES.reduce((n, m) => n + byMode[m], 0),
    newWaitingByMode: byMode,
    extraMode,
    newPaused: !!load && load.plan.newFactor === 0,
    aheadCount: ahead.items.filter((i) => i.kind === 'review').length,
    practice,
  };
}
