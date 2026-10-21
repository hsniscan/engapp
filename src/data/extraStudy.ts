// "Biraz daha çalış": what is left to do once today's queue is empty.
//   - extra new cards: a per-day allowance on top of daily_new_limit, stored in this device's
//     meta (`extra_new:<day>`). Cards introduced today are counted from the review logs, so a
//     second device never introduces them twice; it just does not know about the allowance.
//   - review ahead: tomorrow's reviews through the normal answer path (getStudyQueue 'ahead').
//   - practice: see data/practice.ts.
import { dayKeyOf } from '../domain/day';
import { buildQueue } from '../domain/queue';
import type { Millis } from '../domain/types';
import { db } from './db';
import { ActionError } from './errors';
import { loadTodayFacts, newCards } from './history';
import { EXTRA_NEW_PREFIX, extraNewKey, setMeta } from './meta';
import { getPracticeSourceCounts, type PracticeSourceCounts } from './practice';
import { getExtraNewToday, getStudyQueue } from './queries';
import { dayConfig, getSettings } from './settings';

/** Largest single extra step the UI offers is 10; this only guards against nonsense. */
export const MAX_EXTRA_NEW_STEP = 100;

/**
 * Allow `n` more new cards today (on this device). Returns today's total extra allowance.
 * Allowances of other days are removed.
 */
export async function addExtraNew(n: number, now: Millis = Date.now()): Promise<number> {
  if (!Number.isInteger(n) || n < 1 || n > MAX_EXTRA_NEW_STEP) throw new ActionError('invalid_input', 'Invalid extra count');
  return db.transaction('rw', [db.meta, db.settings], async () => {
    const settings = await getSettings(now);
    const day = dayKeyOf(now, dayConfig(settings));
    const total = (await getExtraNewToday(day)) + n;
    const stale = (await db.meta.where('key').startsWith(EXTRA_NEW_PREFIX).primaryKeys()).filter((k) => k !== extraNewKey(day));
    await db.meta.bulkDelete(stale);
    await setMeta(extraNewKey(day), total);
    return total;
  });
}

export interface MoreStudyOverview {
  /** Cards still to do today in the normal queue (0 = "Bugünlük bitti"). */
  dueNow: number;
  dailyNewLimit: number;
  extraNewToday: number;
  /** New cards that could still be introduced today if the limit allowed (one per note). */
  newWaiting: number;
  /** Tomorrow's reviews that can be done now ("Yarının kartları"). */
  aheadCount: number;
  practice: PracticeSourceCounts;
}

export async function getMoreStudyOverview(now: Millis = Date.now()): Promise<MoreStudyOverview> {
  const [normal, ahead, practice, waiting, settings] = await Promise.all([
    getStudyQueue({ learnAheadMs: 0 }, now),
    getStudyQueue({ mode: 'ahead', learnAheadMs: 0 }, now),
    getPracticeSourceCounts(now),
    countNewWaiting(now),
    getSettings(now),
  ]);
  return {
    dueNow: normal.counts.total,
    dailyNewLimit: settings.daily_new_limit,
    extraNewToday: normal.extraNewToday,
    newWaiting: waiting,
    aheadCount: ahead.items.filter((i) => i.kind === 'review' && i.card.due >= ahead.dayEnd).length,
    practice,
  };
}

/** New cards that are studiable now and not buried, one per note, ignoring the daily limit. */
async function countNewWaiting(now: Millis): Promise<number> {
  return db.transaction('r', [db.cards, db.review_logs, db.settings], async () => {
    const settings = await getSettings(now);
    const facts = await loadTodayFacts(dayConfig(settings), now);
    const q = buildQueue(await newCards(), {
      now,
      dayEnd: facts.bounds.end,
      dailyNewLimit: Infinity,
      newIntroducedToday: 0,
      reviewedTodayCardIds: facts.reviewedCardIds,
      reviewedTodayNoteIds: facts.reviewedNoteIds,
      learnAheadMs: 0,
    });
    return q.counts.new;
  });
}
