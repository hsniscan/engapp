// Streak protections, data side (v0.5 İP10, docs/decisions/0052-smart-review.md). The rule is
// domain/streakFreeze.ts; the covered days live in the synced settings row (streak_freezes),
// written through the sync writer like every settings change, so they reach the account's
// other devices and never another account.
import { dayKeyOf, type DayKey } from '../domain/day';
import { isActive } from '../domain/streak';
import {
  FREEZES_PER_MONTH,
  freezeNote,
  freezesLeftIn,
  type FreezeFacts,
  type FreezeNote,
  frozenDayRule,
  monthOf,
  parseFreezeDays,
  planFreezes,
  usedFreezeDays,
  withFreezeDays,
} from '../domain/streakFreeze';
import type { Millis, Settings } from '../domain/types';
import { isVacationDay } from '../domain/vacation';
import { db } from './db';
import { getMeta, setMeta } from './meta';
import { dayConfig, getSettings, SETTINGS_ID } from './settings';
import { writeTx } from './writer';

/** Meta key of the covered day whose note the user closed (this device only). */
export const FREEZE_NOTE_SEEN_KEY = 'streak_freeze_note_seen';

async function activeDays(): Promise<Set<DayKey>> {
  const rows = await db.daily_activity.toArray();
  return new Set(rows.filter(isActive).map((d) => d.date));
}

function factsOf(settings: Settings, active: Set<DayKey>, now: Millis): FreezeFacts {
  return {
    active,
    isVacationDay: (day) => isVacationDay(settings, day),
    freezeDays: parseFreezeDays(settings.streak_freezes),
    today: dayKeyOf(now, dayConfig(settings)),
  };
}

/** What makes a day neutral for the streak: a vacation day or a covered day. */
export function streakFrozenDay(settings: Settings): (day: DayKey) => boolean {
  return frozenDayRule({ isVacationDay: (day) => isVacationDay(settings, day), freezeDays: parseFreezeDays(settings.streak_freezes) });
}

let running: Promise<DayKey[]> | null = null;

/**
 * Cover the missed days since the last active day, when this month's protections can cover
 * them all (domain/streakFreeze.ts planFreezes). Returns the days covered now (usually none).
 * Safe to call often (app start, Bugün): it writes only when something is to be covered, and
 * reads and writes in one transaction, so two tabs never spend a protection twice.
 */
export function ensureStreakFreezes(now: Millis = Date.now()): Promise<DayKey[]> {
  running ??= writeTx([db.settings, db.daily_activity], now, async (w) => {
    const settings = await db.settings.get(SETTINGS_ID);
    if (!settings) return [];
    const plan = planFreezes(factsOf(settings, await activeDays(), now));
    if (plan.length === 0) return [];
    await w.put('settings', { ...settings, streak_freezes: withFreezeDays(settings.streak_freezes, plan) });
    return plan;
  }).finally(() => {
    running = null;
  });
  return running;
}

export interface StreakFreezeView {
  /** The calm note for today, or null. */
  note: FreezeNote | null;
  /** Protections left this month, and the monthly allowance. */
  left: number;
  perMonth: number;
  /** Days covered this month. */
  usedThisMonth: DayKey[];
}

/** For Bugün (read-only; safe in a live query). */
export async function getStreakFreezeView(now: Millis = Date.now()): Promise<StreakFreezeView> {
  const [settings, active, seen] = await Promise.all([getSettings(now), activeDays(), getMeta<string>(FREEZE_NOTE_SEEN_KEY)]);
  const facts = factsOf(settings, active, now);
  const used = usedFreezeDays(facts);
  const month = monthOf(facts.today);
  return {
    note: freezeNote(facts, typeof seen === 'string' ? seen : null),
    left: freezesLeftIn(used, month),
    perMonth: FREEZES_PER_MONTH,
    usedThisMonth: used.filter((d) => monthOf(d) === month),
  };
}

/** "Tamam": the note about this covered day is not shown again on this device. */
export async function dismissFreezeNote(day: DayKey): Promise<void> {
  await setMeta(FREEZE_NOTE_SEEN_KEY, day);
}
