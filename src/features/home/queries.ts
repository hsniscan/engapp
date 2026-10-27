// Read-only view models for the home screen and the end-of-session summary.
// Everything comes from indexed reads and the daily_activity cache, so it is safe (and
// fast) inside useLiveQuery.
import Dexie from 'dexie';
import { db, getSettings, getStreakSummary } from '@/data';
import {
  addDays,
  type DayConfig,
  dayBounds,
  dayKeyOf,
  type DayKey,
  dayEndMs,
  isValidTimeZone,
} from '@/domain/day';
import type { StreakSummary } from '@/domain/streak';
import { type Card, CardState, type CardType, type Millis, type Settings } from '@/domain/types';

const STUDIED_STATES = [CardState.Learning, CardState.Review, CardState.Relearning] as const;

export function cfgOf(s: Pick<Settings, 'timezone' | 'day_start_hour'>): DayConfig {
  return {
    timezone: isValidTimeZone(s.timezone) ? s.timezone : 'UTC',
    day_start_hour: s.day_start_hour,
  };
}

const studiable = (c: Card) => c.deleted_at === null && !c.suspended && c.unlocked;

/** When the next card is waiting, once today's queue is empty. */
export type NextDue =
  | { kind: 'later'; at: Millis }
  | { kind: 'tomorrow'; count: number }
  | { kind: 'date'; day: DayKey }
  | { kind: 'none' };

/** Studied cards due before `until`, through the [state+due] index. */
async function studiedDueBefore(until: Millis): Promise<Card[]> {
  const parts = await Promise.all(
    STUDIED_STATES.map((s) =>
      db.cards.where('[state+due]').between([s, Dexie.minKey], [s, until], true, false).toArray(),
    ),
  );
  return parts.flat().filter(studiable);
}

async function nextDueFrom(
  now: Millis,
  cfg: DayConfig,
  settings: Settings,
  all: Card[],
  types?: readonly CardType[],
): Promise<NextDue> {
  const ofTypes = (c: Card) => !types || types.includes(c.card_type);
  const soon = types ? all.filter(ofTypes) : all;
  const today = dayBounds(now, cfg);
  let later: Millis | null = null;
  for (const c of soon) {
    const learning = c.state === CardState.Learning || c.state === CardState.Relearning;
    if (learning && c.due > now && c.due < today.end && (later === null || c.due < later))
      later = c.due;
  }
  if (later !== null) return { kind: 'later', at: later };

  const tomorrowEnd = dayEndMs(addDays(today.key, 1), cfg);
  const dueTomorrow = soon.filter((c) => c.due < tomorrowEnd).length;
  // getAll, then filter: a Dexie .filter() walks a cursor, one IndexedDB round trip per row.
  const fresh = (
    await db.cards
      .where('[state+due]')
      .between([CardState.New, Dexie.minKey], [CardState.New, Dexie.maxKey])
      .toArray()
  ).filter((c) => studiable(c) && ofTypes(c)).length;
  const count = dueTomorrow + Math.min(fresh, settings.daily_new_limit);
  if (count > 0) return { kind: 'tomorrow', count };

  let first: Millis | null = null;
  for (const s of STUDIED_STATES) {
    const c = await db.cards
      .where('[state+due]')
      .between([s, Dexie.minKey], [s, Dexie.maxKey])
      .filter((c) => studiable(c) && ofTypes(c))
      .first();
    if (c && (first === null || c.due < first)) first = c.due;
  }
  return first === null ? { kind: 'none' } : { kind: 'date', day: dayKeyOf(first, cfg) };
}

/** `types`: only these card types (one study mode's empty screen counts its own cards). */
export async function getNextDue(
  now: Millis = Date.now(),
  types?: readonly CardType[],
): Promise<NextDue> {
  const settings = await getSettings(now);
  const cfg = cfgOf(settings);
  const until = dayEndMs(addDays(dayKeyOf(now, cfg), 1), cfg);
  return nextDueFrom(now, cfg, settings, await studiedDueBefore(until), types);
}

export interface HomeCore {
  streak: StreakSummary;
  /** At least one live note: false shows the welcome screen. */
  hasCards: boolean;
  /** When the next cards come (shown once the word study is done). */
  next: NextDue;
  timezone: string;
  now: Millis;
}

/** Streak, recall and "what comes next" for the home screen. */
export async function getHomeCore(now: Millis = Date.now()): Promise<HomeCore> {
  const settings = await getSettings(now);
  const [streak, anyNote, next] = await Promise.all([
    getStreakSummary(now),
    db.notes.filter((n) => n.deleted_at === null).first(),
    getNextDue(now),
  ]);
  return {
    streak,
    hasCards: anyNote !== undefined,
    next,
    timezone: cfgOf(settings).timezone,
    now,
  };
}
