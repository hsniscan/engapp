import { z } from 'zod';
import {
  EXAMPLE_CONTEXT_KEYS,
  MAX_EXAMPLE_CONTEXTS,
  MIN_SELECTED_CONTEXTS,
} from '../../supabase/functions/_shared/examples-contracts';
import { type DayConfig, deviceTimeZone, isValidTimeZone } from '../domain/day';
import { CAPACITY_MIN_LIMITS } from '../domain/capacity';
import { createScheduler, RETENTION_MAX, RETENTION_MIN, type Scheduler } from '../domain/fsrs';
import { DAY_MINUTES_LIMITS, GOAL_LIMITS, type GoalKey } from '../domain/goals';
import { FIRST_NOTIFY_HOUR, LAST_NOTIFY_HOUR } from '../domain/notify';
import { isValidRange, MAX_VACATION_HISTORY } from '../domain/vacation';
import { MAX_FREEZE_DAYS } from '../domain/streakFreeze';
import { HLC_ZERO } from '../domain/hlc';
import type { Millis, Settings } from '../domain/types';
import { db } from './db';
import { writeTx } from './writer';

export const SETTINGS_ID = 'settings';

export const DEFAULT_SETTINGS = {
  daily_new_limit: 10,
  request_retention: 0.9,
  day_start_hour: 4,
  theme: 'system',
  voice: 'en-US',
  level: 'B1',
  fsrs_params: null,
  last_backup_at: null,
  level_source: 'default',
  level_updated_at: null,
  level_locked: false,
  level_change: null,
  show_easy_candidates: false,
} as const satisfies Partial<Settings>;

/** Defaults; timezone comes from the device. Not persisted by itself. */
export function defaultSettings(now: Millis, userId: string | null = null): Settings {
  return {
    id: SETTINGS_ID,
    user_id: userId,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    hlc: HLC_ZERO,
    ...DEFAULT_SETTINGS,
    timezone: deviceTimeZone(),
  };
}

/** Stored settings, or defaults when none were saved yet. */
export async function getSettings(now: Millis = Date.now()): Promise<Settings> {
  return (await db.settings.get(SETTINGS_ID)) ?? defaultSettings(now);
}

/** Persist the defaults on first run (so the account creation day is known). */
export async function ensureSettings(now: Millis = Date.now()): Promise<Settings> {
  return writeTx([db.settings], now, async (w) => {
    const existing = await db.settings.get(SETTINGS_ID);
    if (existing) return existing;
    return w.put('settings', { ...defaultSettings(now, w.userId), hlc: w.nextHlc() });
  });
}

const goalValue = (key: GoalKey) =>
  z.number().int().min(GOAL_LIMITS[key].min).max(GOAL_LIMITS[key].max).nullable().optional();

const vacationRangeSchema = z
  .object({ start: z.string(), end: z.string() })
  .refine(isValidRange, 'Invalid vacation range');

export const settingsPatchSchema = z
  .object({
    daily_new_limit: z.number().int().min(0).max(999),
    request_retention: z.number().min(RETENTION_MIN).max(RETENTION_MAX),
    timezone: z.string().refine(isValidTimeZone, 'Unknown time zone'),
    day_start_hour: z.number().int().min(0).max(23),
    theme: z.enum(['system', 'light', 'dark']),
    voice: z.enum(['en-US', 'en-GB']),
    level: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']),
    fsrs_params: z.array(z.number()).nullable(),
    last_backup_at: z.number().int().nullable(),
    // v0.2 İP5: show sentence translations without a tap; contexts prepared in the background.
    example_tr_visible: z.boolean(),
    example_contexts: z
      .array(z.enum(EXAMPLE_CONTEXT_KEYS as [string, ...string[]]))
      .min(MIN_SELECTED_CONTEXTS)
      .max(MAX_EXAMPLE_CONTEXTS)
      .refine((a) => new Set(a).size === a.length, 'Duplicate context'),
    interests: z.array(z.string().min(1).max(40)).max(40),
    muted_topics: z.array(z.string().min(1).max(40)).max(40),
    level_locked: z.boolean(),
    show_easy_candidates: z.boolean(),
    // v0.4 İP3: the picture on the front of the card too.
    show_image_front: z.boolean(),
    // v0.4 İP8: picture cards (decision 0036).
    image_cards: z.boolean(),
    // v0.4: new-card order ("Yeni kelime sırası", docs/decisions/0039).
    new_card_order: z.enum(['smart', 'added']),
    // v0.5 İP10: days a streak protection covered (domain/streakFreeze.ts, decision 0052).
    streak_freezes: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(MAX_FREEZE_DAYS).nullable(),
    // v0.3 İP3 load management (domain/capacity.ts, catchup.ts, vacation.ts).
    daily_capacity_min: z.number().int().min(CAPACITY_MIN_LIMITS.min).max(CAPACITY_MIN_LIMITS.max),
    catchup_auto: z.boolean(),
    vacation: vacationRangeSchema.nullable(),
    vacation_history: z.array(vacationRangeSchema).max(MAX_VACATION_HISTORY).nullable(),
    // v0.3 İP8: the hour is resolved by domain/notify.ts; 09–21 here, in settingsSchema and in
    // the push rule (decision 0024: a reminder at 22:00 would fall into the quiet hours).
    notify: z.object({
      enabled: z.boolean(),
      mode: z.enum(['auto', 'fixed']),
      hour: z.number().int().min(FIRST_NOTIFY_HOUR).max(LAST_NOTIFY_HOUR).nullable(),
    }),
    // v0.3 İP7: goals on the continuity panel (domain/goals.ts); null = no goals at all.
    goals: z
      .object({
        week_active_days: goalValue('week_active_days'),
        month_new_terms: goalValue('month_new_terms'),
        week_minutes: goalValue('week_minutes'),
        // Redesign home goals ("Hedeflerin"): minutes a day and the level aimed for.
        day_minutes: z
          .number()
          .int()
          .min(DAY_MINUTES_LIMITS.min)
          .max(DAY_MINUTES_LIMITS.max)
          .nullable()
          .optional(),
        target_level: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']).nullable().optional(),
      })
      .nullable(),
  })
  .partial();

export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

/** Validate and save a partial settings change. Throws ZodError on invalid input. */
export async function updateSettings(
  patch: SettingsPatch,
  now: Millis = Date.now(),
): Promise<Settings> {
  const clean = settingsPatchSchema.parse(patch);
  return writeTx([db.settings], now, async (w) => {
    const current = (await db.settings.get(SETTINGS_ID)) ?? defaultSettings(now, w.userId);
    const next: Settings = { ...current, ...clean };
    // Choosing a level by hand: it is the user's own from now on (the weekly update waits two
    // weeks before it looks at it again, docs/decisions/0017) and the last automatic change
    // is no longer news.
    if (clean.level !== undefined && clean.level !== current.level) {
      next.level_source = 'manual';
      next.level_updated_at = now;
      next.level_change = null;
    }
    createScheduler(next); // validates fsrs_params against ts-fsrs
    return w.put('settings', next);
  });
}

export function dayConfig(s: Pick<Settings, 'timezone' | 'day_start_hour'>): DayConfig {
  return {
    timezone: isValidTimeZone(s.timezone) ? s.timezone : 'UTC',
    day_start_hour: s.day_start_hour,
  };
}

let cached: { key: string; scheduler: Scheduler } | null = null;

/** Scheduler for these settings (memoized); falls back to defaults on invalid stored values. */
export function schedulerFor(s: Pick<Settings, 'request_retention' | 'fsrs_params'>): Scheduler {
  const key = `${s.request_retention}|${s.fsrs_params?.join(',') ?? ''}`;
  if (cached?.key === key) return cached.scheduler;
  let scheduler: Scheduler;
  try {
    scheduler = createScheduler(s);
  } catch {
    scheduler = createScheduler({
      request_retention: DEFAULT_SETTINGS.request_retention,
      fsrs_params: null,
    });
  }
  cached = { key, scheduler };
  return scheduler;
}
