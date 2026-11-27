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
import { availableAt } from '@/domain/leech';
import type { StreakSummary } from '@/domain/streak';
import { type Card, CardState, type CardType, type Millis, type Settings } from '@/domain/types';

const STUDIED_STATES = [CardState.Learning, CardState.Review, CardState.Relearning] as const;

export function cfgOf(s: Pick<Settings, 'timezone' | 'day_start_hour'>): DayConfig {
  return {
    timezone: isValidTimeZone(s.timezone) ? s.timezone : 'UTC',
    day_start_hour: s.day_start_hour,
  };
}

// A resting card (rest_until, ADR 0071) stays studiable here, but every due comparison uses
// availableAt: it comes back when its rest ends, not at its short relearning due.
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
    const at = availableAt(c);
    if (learning && at > now && at < today.end && (later === null || at < later)) later = at;
  }
  if (later !== null) return { kind: 'later', at: later };

  const tomorrowEnd = dayEndMs(addDays(today.key, 1), cfg);
  const dueTomorrow = soon.filter((c) => availableAt(c) < tomorrowEnd).length;
  // getAll, then filter: a Dexie .filter() walks a cursor, one IndexedDB round trip per row.
  const fresh = (
    await db.cards
      .where('[state+due]')
      .between([CardState.New, Dexie.minKey], [CardState.New, Dexie.maxKey])
      .toArray()
  ).filter((c) => studiable(c) && ofTypes(c)).length;
  const count = dueTomorrow + Math.min(fresh, settings.daily_new_limit);
  if (count > 0) return { kind: 'tomorrow', count };

  const best: { at: Millis | null } = { at: null };
  for (const s of STUDIED_STATES) {
    // The first non-resting card in due order; resting cards met on the way count with their
    // rest end (they are few, so the walk stays short).
    await db.cards
      .where('[state+due]')
      .between([s, Dexie.minKey], [s, Dexie.maxKey])
      .until((c) => best.at !== null && c.due >= best.at)
      .each((c) => {
        if (!studiable(c) || !ofTypes(c)) return;
        const at = availableAt(c);
        if (best.at === null || at < best.at) best.at = at;
      });
  }
  return best.at === null ? { kind: 'none' } : { kind: 'date', day: dayKeyOf(best.at, cfg) };
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
  /** The hour the study day starts (the header names the study day). */
  dayStartHour: number;
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
    dayStartHour: cfgOf(settings).day_start_hour,
    now,
  };
}
