// What the Android app's reminder scheduler needs from the local database
// (src/domain/reminderSchedule.ts, docs/decisions/0033-android-capacitor.md). The same facts the
// server's push-send reads from the synced tables (push_candidates / push_due_counts), here from
// Dexie, so guests and offline answers count too.
import Dexie from 'dexie';
import { REMINDER_HORIZON_DAYS } from '../domain/reminderSchedule';
import { CardState, type Card, type Millis, type ReviewLog, type Settings } from '../domain/types';
import { db } from './db';
import { getSettings } from './settings';

const STUDIED = [CardState.Learning, CardState.Review, CardState.Relearning] as const;
const PACE_WINDOW_MS = 30 * 86_400_000;

export interface ReminderFacts {
  settings: Settings;
  /** Latest answered review (undo rows excluded), as the server counts it. */
  lastReviewAt: Millis | null;
  /** Due instants of studied, live, unsuspended, unlocked cards up to the horizon, ascending. */
  dueTimes: Millis[];
  /** Median answer time in seconds over 30 days (answers capped at 60 s); null without history. */
  secPerCard: number | null;
}

const studiable = (c: Card) => c.deleted_at === null && !c.suspended && c.unlocked;

export function medianSeconds(logs: readonly Pick<ReviewLog, 'duration_ms'>[]): number | null {
  const xs = logs
    .map((l) => Math.min(l.duration_ms, 60_000))
    .filter((d) => d > 0)
    .sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = xs.length >> 1;
  const ms = xs.length % 2 ? xs[mid]! : (xs[mid - 1]! + xs[mid]!) / 2;
  return ms / 1000;
}

export async function getReminderFacts(now: Millis = Date.now()): Promise<ReminderFacts> {
  const until = now + (REMINDER_HORIZON_DAYS + 1) * 86_400_000;
  const [settings, last, dueParts, recent] = await Promise.all([
    getSettings(now),
    db.review_logs
      .orderBy('reviewed_at')
      .reverse()
      .filter((l) => l.undo_of === null)
      .first(),
    Promise.all(
      STUDIED.map((s) =>
        db.cards.where('[state+due]').between([s, Dexie.minKey], [s, until], true, false).toArray(),
      ),
    ),
    db.review_logs
      .where('reviewed_at')
      .between(now - PACE_WINDOW_MS, now, true, true)
      .filter((l) => l.undo_of === null)
      .toArray(),
  ]);
  return {
    settings,
    lastReviewAt: last?.reviewed_at ?? null,
    dueTimes: dueParts
      .flat()
      .filter(studiable)
      .map((c) => c.due)
      .sort((a, b) => a - b),
    secPerCard: medianSeconds(recent),
  };
}
