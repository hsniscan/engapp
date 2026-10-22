// Smart notifications on the device (v0.3 İP8, docs/decisions/0024-web-push.md). The send rule
// is the server's own (supabase/functions/_shared/push-rule.ts, re-exported here); the device
// only works out the "auto" hour from its review history and stores it in settings.notify, so
// the server never needs the history to pick a time.
import {
  clampNotifyHour,
  DEFAULT_NOTIFY_HOUR,
  FIRST_NOTIFY_HOUR,
  LAST_NOTIFY_HOUR,
  parseNotify,
  QUIET_FROM_HOUR,
  QUIET_UNTIL_HOUR,
  type NotifyMode,
  type NotifyPref,
} from '../../supabase/functions/_shared/push-rule';
import { wallClock } from './day';
import type { Millis } from './types';

export {
  clampNotifyHour,
  DEFAULT_NOTIFY_HOUR,
  FIRST_NOTIFY_HOUR,
  LAST_NOTIFY_HOUR,
  parseNotify,
  QUIET_FROM_HOUR,
  QUIET_UNTIL_HOUR,
  type NotifyMode,
  type NotifyPref,
};

/** History window for the automatic hour. */
export const AUTO_HOUR_WINDOW_DAYS = 21;
/** A pause this long between two answers starts a new session. */
export const SESSION_GAP_MS = 30 * 60_000;

/**
 * The hour the user most often starts reviewing: the mode of session start hours (local
 * wall clock) over the last 21 days, ties to the earlier hour, kept inside 09–21. Without
 * history: DEFAULT_NOTIFY_HOUR.
 */
export function autoNotifyHour(
  reviewedAt: Iterable<Millis>,
  timezone: string,
  now: Millis,
): number {
  const from = now - AUTO_HOUR_WINDOW_DAYS * 86_400_000;
  const times = [...reviewedAt].filter((t) => t >= from && t <= now).sort((a, b) => a - b);
  const counts = new Map<number, number>();
  let prev = -Infinity;
  for (const t of times) {
    if (t - prev >= SESSION_GAP_MS) {
      const h = wallClock(t, timezone).hour;
      counts.set(h, (counts.get(h) ?? 0) + 1);
    }
    prev = t;
  }
  let best: number | null = null;
  let bestCount = 0;
  for (const [h, n] of counts) {
    if (n > bestCount || (n === bestCount && best !== null && h < best)) {
      best = h;
      bestCount = n;
    }
  }
  return clampNotifyHour(best ?? DEFAULT_NOTIFY_HOUR);
}

/** settings.notify after a change on the device: the hour is always resolved. */
export function resolveNotify(
  current: unknown,
  change: { enabled?: boolean; mode?: NotifyMode; hour?: number },
  autoHour: number,
): NotifyPref {
  const cur = parseNotify(current) ?? { enabled: false, mode: 'auto' as NotifyMode, hour: null };
  const mode = change.mode ?? cur.mode;
  const hour =
    mode === 'auto'
      ? clampNotifyHour(autoHour)
      : clampNotifyHour(change.hour ?? cur.hour ?? autoHour);
  return { enabled: change.enabled ?? cur.enabled, mode, hour };
}
