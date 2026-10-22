// settings.notify on the device (v0.3 İP8): the automatic reminder hour from the local review
// history (domain/notify.ts). The device stores the resolved hour so the server can use it.
import {
  AUTO_HOUR_WINDOW_DAYS,
  autoNotifyHour,
  parseNotify,
  resolveNotify,
  type NotifyMode,
} from '../domain/notify';
import { effectiveLogs } from '../domain/recompute';
import type { Millis, NotifySetting, Settings } from '../domain/types';
import { db } from './db';
import { dayConfig, getSettings, updateSettings } from './settings';

/** The automatic hour from this device's answers of the last 21 days. */
export async function computeAutoHour(
  now: Millis = Date.now(),
  settings?: Settings,
): Promise<number> {
  const s = settings ?? (await getSettings(now));
  const from = now - AUTO_HOUR_WINDOW_DAYS * 86_400_000;
  // Undo rows may point at answers just before the window: take a day more, then filter.
  const logs = await db.review_logs
    .where('reviewed_at')
    .between(from - 86_400_000, now, true, true)
    .toArray();
  const times = effectiveLogs(logs).map((l) => l.reviewed_at);
  return autoNotifyHour(times, dayConfig(s).timezone, now);
}

/** Saves a change of the reminder setting, with the hour resolved. */
export async function saveNotify(
  change: { enabled?: boolean; mode?: NotifyMode; hour?: number },
  now: Millis = Date.now(),
): Promise<NotifySetting> {
  const s = await getSettings(now);
  const next = resolveNotify(s.notify, change, await computeAutoHour(now, s));
  await updateSettings({ notify: next }, now);
  return next;
}

/** Auto mode: store the hour again when the history moved it. Returns true when it changed. */
export async function refreshAutoHour(now: Millis = Date.now()): Promise<boolean> {
  const s = await getSettings(now);
  const pref = parseNotify(s.notify);
  if (!pref?.enabled || pref.mode !== 'auto') return false;
  const hour = await computeAutoHour(now, s);
  if (hour === pref.hour) return false;
  await updateSettings({ notify: { ...pref, hour } }, now);
  return true;
}
