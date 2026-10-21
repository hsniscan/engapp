import { z } from 'zod';
import {
  EXAMPLE_CONTEXT_KEYS,
  MAX_EXAMPLE_CONTEXTS,
  MIN_SELECTED_CONTEXTS,
} from '../../supabase/functions/_shared/examples-contracts';
import { type DayConfig, deviceTimeZone, isValidTimeZone } from '../domain/day';
import { createScheduler, RETENTION_MAX, RETENTION_MIN, type Scheduler } from '../domain/fsrs';
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
  })
  .partial();

export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

/** Validate and save a partial settings change. Throws ZodError on invalid input. */
export async function updateSettings(patch: SettingsPatch, now: Millis = Date.now()): Promise<Settings> {
  const clean = settingsPatchSchema.parse(patch);
  return writeTx([db.settings], now, async (w) => {
    const current = (await db.settings.get(SETTINGS_ID)) ?? defaultSettings(now, w.userId);
    const next: Settings = { ...current, ...clean };
    createScheduler(next); // validates fsrs_params against ts-fsrs
    return w.put('settings', next);
  });
}

export function dayConfig(s: Pick<Settings, 'timezone' | 'day_start_hour'>): DayConfig {
  return { timezone: isValidTimeZone(s.timezone) ? s.timezone : 'UTC', day_start_hour: s.day_start_hour };
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
    scheduler = createScheduler({ request_retention: DEFAULT_SETTINGS.request_retention, fsrs_params: null });
  }
  cached = { key, scheduler };
  return scheduler;
}
