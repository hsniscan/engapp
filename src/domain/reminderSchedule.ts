// The Android app's daily reminder, worked out on the phone (docs/decisions/0033-android-capacitor.md).
//
// The rule is the server's own (decidePush / pushSlot in supabase/functions/_shared/push-rule.ts,
// decision 0024): at most one a day, 09:00–22:00 local time and at or after the chosen hour, not
// on a day already studied, not on vacation, only with reviews due before the day ends. The
// phone cannot run code at the right moment, so it schedules ONE local notification in advance:
// the earliest instant at which decidePush would send, assuming nothing changes until then. The
// app reschedules after every answer and whenever it comes to the foreground, so a study session
// or a settings change replaces the plan.
//
// Exactness: pushSlot depends only on the local wall-clock hour, the user day and its bounds, and
// the due count only on the user day (cards due before its end). All of these are constant
// between two local hour boundaries, so checking `now + delay` and then every local hour boundary
// finds the earliest sending instant exactly (reminderSchedule.test.ts compares it with
// decidePush minute by minute in six time zones, DST included).
import {
  decidePush,
  pushSlot,
  safeTimeZone,
  type PushCandidate,
  type PushMessage,
} from '../../supabase/functions/_shared/push-rule';
import { wallClock } from './day';
import type { Millis } from './types';

const HOUR_MS = 3_600_000;
/** How far ahead reminders are planned (the app reschedules whenever it is opened). */
export const REMINDER_HORIZON_DAYS = 30;
/**
 * Reminders planned in advance: the next one plus the following days', so a user who does not
 * open the app still gets one a day (as Web Push would send). Each is the rule's answer assuming
 * the earlier ones were shown and nothing was studied; studying replaces them all.
 */
export const REMINDER_CHAIN = 7;
/** Never fire right away: the user is in the app when this runs. */
export const REMINDER_MIN_DELAY_MS = 60_000;

export interface ReminderInput {
  /** The device's preference in `notify` (enabled = this phone's switch), synced settings rest. */
  candidate: PushCandidate;
  /** Due instants of studied, live, unsuspended, unlocked cards, ascending. */
  dueTimes: readonly Millis[];
  /** Median answer time (s) for the "~N dk" text; null without history. */
  secPerCard: number | null;
  now: Millis;
  horizonDays?: number;
  minDelayMs?: number;
}

export interface PlannedReminder {
  at: Millis;
  /** User day (YYYY-MM-DD) the reminder belongs to. */
  day: string;
  due: number;
  message: PushMessage;
}

/** Number of entries < `until` in an ascending list. */
export function countBefore(sorted: readonly Millis[], until: Millis): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! < until) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First local hour boundary (minute 0, second 0) strictly after `t`. */
export function nextHourBoundary(t: Millis, tz: string): Millis {
  const w = wallClock(t, tz);
  const intoHour = w.minute * 60_000 + w.second * 1000 + (((t % 1000) + 1000) % 1000);
  return t - intoHour + HOUR_MS;
}

/** The answer decidePush would give at `t` with the due count of t's user day. */
export function decideAt(input: ReminderInput, t: Millis) {
  const slot = pushSlot(input.candidate, t);
  const due = slot.ok ? countBefore(input.dueTimes, slot.dayEnd) : 0;
  return { due, decision: decidePush(input.candidate, t, due, input.secPerCard) };
}

/** The single next reminder, or null when none is due within the horizon. */
export function nextReminder(input: ReminderInput): PlannedReminder | null {
  const tz = safeTimeZone(input.candidate.timezone);
  const start = input.now + (input.minDelayMs ?? REMINDER_MIN_DELAY_MS);
  const end = input.now + (input.horizonDays ?? REMINDER_HORIZON_DAYS) * 86_400_000;
  for (let t = start; t <= end; t = nextHourBoundary(t, tz)) {
    const { due, decision } = decideAt(input, t);
    if (decision.send) return { at: t, day: decision.day, due, message: decision.message };
  }
  return null;
}

/**
 * The daily budget (v0.5 İP10, docs/decisions/0052): at most one reminder per user day, and
 * none on a day one was already shown. A reminder that asks a card (decision 0048) is that
 * day's reminder, not an extra one. Keeps the earliest of a day; order is kept.
 */
export function onePerDay<T extends { day: string }>(plans: readonly T[], shownDay: string | null): T[] {
  const seen = new Set<string>(shownDay ? [shownDay] : []);
  const out: T[] = [];
  for (const p of plans) {
    if (seen.has(p.day)) continue;
    seen.add(p.day);
    out.push(p);
  }
  return out;
}

/**
 * The next `count` reminders: each is nextReminder() after the previous one, with the previous
 * one's day counted as already reminded (at most one a day). Days strictly increase.
 */
export function planReminders(input: ReminderInput, count = REMINDER_CHAIN): PlannedReminder[] {
  const out: PlannedReminder[] = [];
  const end = input.now + (input.horizonDays ?? REMINDER_HORIZON_DAYS) * 86_400_000;
  let step: ReminderInput = input;
  while (out.length < count) {
    const days = Math.max(0, (end - step.now) / 86_400_000);
    const next = nextReminder({ ...step, horizonDays: days });
    if (!next) break;
    out.push(next);
    step = {
      ...step,
      now: next.at,
      minDelayMs: 1,
      candidate: { ...step.candidate, last_push_day: next.day },
    };
  }
  return out;
}
