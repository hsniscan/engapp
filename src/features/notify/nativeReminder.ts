// Daily reminder in the Android app: one local notification, planned on the phone
// (docs/decisions/0033-android-capacitor.md). The switch is per device and kept on the device;
// hour and mode come from the synced settings.notify (the same choice as on the web), the rule is
// the shared one (src/domain/reminderSchedule.ts → decidePush). Turning it on removes this
// account's Web Push subscriptions, so one person never gets two reminders a day.
//
// Platform calls go through `NotifierPort` (src/native/reminders.ts implements it with
// @capacitor/local-notifications), so this file is testable without a phone.
import { useSyncExternalStore } from 'react';
import { getReminderFacts, type ReminderFacts } from '@/data/reminder';
import { dayKeyOf } from '@/domain/day';
import { parseNotify } from '@/domain/notify';
import { nextReminder, type PlannedReminder } from '@/domain/reminderSchedule';
import type { Millis } from '@/domain/types';
import { dayConfig } from '@/data/settings';

export const REMINDER_ID = 1001;
export const REMINDER_CHANNEL = 'engapp-reminders';
const STORE_KEY = 'engapp.nativeReminder';

export type Permission = 'granted' | 'denied' | 'prompt';

export interface ScheduledNotification {
  id: number;
  at: Millis;
  title: string;
  body: string;
  url: string;
}

export interface NotifierPort {
  checkPermission(): Promise<Permission>;
  requestPermission(): Promise<Permission>;
  ensureChannel(): Promise<void>;
  schedule(n: ScheduledNotification): Promise<void>;
  cancel(id: number): Promise<void>;
  /** Removes an already shown reminder from the notification shade. */
  clearShown(id: number): Promise<void>;
}

/** Removes the signed-in account's Web Push subscriptions; resolves to how many, null = failed. */
export type WebPushCleaner = (userId: string) => Promise<number | null>;

export interface ReminderState {
  enabled: boolean;
  /** The pending notification (or the last one, once its time has passed). */
  scheduled: { day: string; at: Millis } | null;
  /** User day of the last reminder that was shown (at most one a day). */
  lastShownDay: string | null;
  /** Account whose Web Push subscriptions were removed for this phone's reminder. */
  webCleanedFor: string | null;
}

const EMPTY: ReminderState = {
  enabled: false,
  scheduled: null,
  lastShownDay: null,
  webCleanedFor: null,
};

// ------------------------------------------------------------------ device store

let cache: ReminderState | null = null;
const listeners = new Set<() => void>();

export function readReminderState(): ReminderState {
  if (cache) return cache;
  try {
    const raw = JSON.parse(
      localStorage.getItem(STORE_KEY) ?? 'null',
    ) as Partial<ReminderState> | null;
    cache = { ...EMPTY, ...(raw && typeof raw === 'object' ? raw : {}) };
  } catch {
    cache = { ...EMPTY };
  }
  return cache;
}

function writeReminderState(patch: Partial<ReminderState>): ReminderState {
  cache = { ...readReminderState(), ...patch };
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(cache));
  } catch {
    // storage unavailable: the plan still holds for this run
  }
  for (const l of listeners) l();
  return cache;
}

/** For tests. */
export function resetReminderStateForTesting(): void {
  cache = null;
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    /* ignore */
  }
}

export function useReminderState(): ReminderState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    readReminderState,
    readReminderState,
  );
}

// ------------------------------------------------------------------ planning

/** The rule's input from the device: this phone's switch, the account's hour and mode. */
export function planFromFacts(
  facts: ReminderFacts,
  state: ReminderState,
  now: Millis,
): PlannedReminder | null {
  if (!state.enabled) return null;
  const pref = parseNotify(facts.settings.notify);
  // A reminder whose time has passed was shown (or replaced by the user opening the app).
  const shown =
    state.scheduled && state.scheduled.at <= now ? state.scheduled.day : state.lastShownDay;
  return nextReminder({
    candidate: {
      timezone: facts.settings.timezone,
      day_start_hour: facts.settings.day_start_hour,
      notify: { enabled: true, mode: pref?.mode ?? 'auto', hour: pref?.hour ?? null },
      vacation: facts.settings.vacation ?? null,
      last_review_at: facts.lastReviewAt,
      last_push_day: shown,
    },
    dueTimes: facts.dueTimes,
    secPerCard: facts.secPerCard,
    now,
  });
}

export interface RescheduleDeps {
  port: NotifierPort;
  facts?: (now: Millis) => Promise<ReminderFacts>;
  now?: () => Millis;
}

let chain: Promise<unknown> = Promise.resolve();

/**
 * Replaces the pending reminder with the next one the rule allows (or none). Runs after every
 * answer, when the app comes to the foreground and when the setting changes. Serialised.
 */
export function rescheduleReminder(deps: RescheduleDeps): Promise<PlannedReminder | null> {
  const run = async () => {
    const now = (deps.now ?? Date.now)();
    const state = readReminderState();
    const lastShownDay =
      state.scheduled && state.scheduled.at <= now ? state.scheduled.day : state.lastShownDay;
    if (!state.enabled) {
      await deps.port.cancel(REMINDER_ID);
      writeReminderState({ scheduled: null, lastShownDay });
      return null;
    }
    const facts = await (deps.facts ?? getReminderFacts)(now);
    const plan = planFromFacts(facts, state, now);
    await deps.port.cancel(REMINDER_ID);
    // Studied today: today's reminder (if it was shown) has done its job.
    const cfg = dayConfig(facts.settings);
    if (facts.lastReviewAt !== null && dayKeyOf(facts.lastReviewAt, cfg) === dayKeyOf(now, cfg))
      await deps.port.clearShown(REMINDER_ID).catch(() => {});
    if (plan) {
      await deps.port.schedule({
        id: REMINDER_ID,
        at: plan.at,
        title: plan.message.title,
        body: plan.message.body,
        url: plan.message.url,
      });
    }
    writeReminderState({
      scheduled: plan ? { day: plan.day, at: plan.at } : null,
      lastShownDay,
    });
    return plan;
  };
  const next = chain.then(run, run);
  chain = next.catch(() => {});
  return next;
}

// ------------------------------------------------------------------ the switch

export type EnableResult =
  | { ok: true; webRemoved: number | null; webFailed: boolean }
  | { ok: false; reason: 'denied' | 'error' };

/**
 * Turns this phone's reminder on: asks for the Android 13+ permission, creates the channel,
 * plans the next reminder and removes the account's Web Push subscriptions.
 */
export async function enableReminder(
  deps: RescheduleDeps & { userId: string | null; cleanWebPush: WebPushCleaner },
): Promise<EnableResult> {
  let perm = await deps.port.checkPermission();
  if (perm !== 'granted') perm = await deps.port.requestPermission();
  if (perm !== 'granted') return { ok: false, reason: 'denied' };
  try {
    await deps.port.ensureChannel();
    writeReminderState({ enabled: true });
    await rescheduleReminder(deps);
  } catch {
    writeReminderState({ enabled: false });
    return { ok: false, reason: 'error' };
  }
  const web = await syncWebPushCleanup(deps.userId, deps.cleanWebPush, true);
  return { ok: true, webRemoved: web.removed, webFailed: web.failed };
}

export async function disableReminder(deps: RescheduleDeps): Promise<void> {
  writeReminderState({ enabled: false });
  await rescheduleReminder(deps);
}

/**
 * While this phone's reminder is on, the signed-in account must have no Web Push subscription.
 * Done once per account (and retried after a failure, e.g. offline).
 */
export async function syncWebPushCleanup(
  userId: string | null,
  clean: WebPushCleaner,
  force = false,
): Promise<{ removed: number | null; failed: boolean }> {
  const state = readReminderState();
  if (!state.enabled || !userId) return { removed: null, failed: false };
  if (!force && state.webCleanedFor === userId) return { removed: null, failed: false };
  const removed = await clean(userId).catch(() => null);
  if (removed === null) {
    writeReminderState({ webCleanedFor: null });
    return { removed: null, failed: true };
  }
  writeReminderState({ webCleanedFor: userId });
  return { removed, failed: false };
}
