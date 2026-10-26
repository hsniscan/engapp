// Daily reminder in the Android app: local notifications planned on the phone, at most one a day
// (docs/decisions/0033-android-capacitor.md). The switch is per device and kept on the device;
// hour and mode come from the synced settings.notify (the same choice as on the web), the rule is
// the shared one (src/domain/reminderSchedule.ts → decidePush). Turning it on removes this
// account's Web Push subscriptions, so one person never gets two reminders a day.
//
// Platform calls go through `NotifierPort` (src/native/reminders.ts implements it with
// @capacitor/local-notifications), so this file is testable without a phone.
import { useSyncExternalStore } from 'react';
import { getReminderFacts, type ReminderFacts } from '@/data/reminder';
import { getReminderCards } from '@/data/widget';
import { dayKeyOf } from '@/domain/day';
import { parseNotify } from '@/domain/notify';
import { planReminders, REMINDER_CHAIN, type PlannedReminder } from '@/domain/reminderSchedule';
import type { Millis } from '@/domain/types';
import { dayConfig } from '@/data/settings';

/** Notification ids REMINDER_ID … REMINDER_ID + REMINDER_CHAIN - 1, one per planned day. */
export const REMINDER_ID = 1001;
const REMINDER_IDS = Array.from({ length: REMINDER_CHAIN }, (_, i) => REMINDER_ID + i);
export const REMINDER_CHANNEL = 'engapp-reminders';
const STORE_KEY = 'engapp.nativeReminder';

export type Permission = 'granted' | 'denied' | 'prompt';

/** A due recognition card the reminder asks (docs/decisions/0048-widget-notification-answers.md). */
export interface ReminderCard {
  card_id: string;
  /** English term (the question). */
  term: string;
  /** Turkish meaning (shown after "Cevabı gör"). */
  meaning: string;
}

export interface ScheduledNotification {
  id: number;
  at: Millis;
  title: string;
  body: string;
  url: string;
  /** Set when the reminder can be answered from the notification. */
  card?: ReminderCard;
}

export interface NotifierPort {
  checkPermission(): Promise<Permission>;
  requestPermission(): Promise<Permission>;
  ensureChannel(): Promise<void>;
  schedule(n: ScheduledNotification[]): Promise<void>;
  cancel(ids: number[]): Promise<void>;
  /** Removes already shown reminders from the notification shade. */
  clearShown(ids: number[]): Promise<void>;
}

/** Removes the signed-in account's Web Push subscriptions; resolves to how many, null = failed. */
export type WebPushCleaner = (userId: string) => Promise<number | null>;

export interface ReminderState {
  enabled: boolean;
  /** The planned notifications (their time may have passed: then they were shown). */
  scheduled: { day: string; at: Millis }[];
  /** User day of the last reminder that was shown (at most one a day). */
  lastShownDay: string | null;
  /** Account whose Web Push subscriptions were removed for this phone's reminder. */
  webCleanedFor: string | null;
  /** The reminder asks one due card ("Cevabı gör", then "Bildim / Bilemedim"). Default on. */
  answerCards: boolean;
}

const EMPTY: ReminderState = {
  enabled: false,
  scheduled: [],
  lastShownDay: null,
  webCleanedFor: null,
  answerCards: true,
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
    if (!Array.isArray(cache.scheduled)) cache.scheduled = [];
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

/** The last day a reminder was shown: a planned one whose time has passed counts as shown. */
export function shownDay(state: ReminderState, now: Millis): string | null {
  let day = state.lastShownDay;
  for (const p of state.scheduled) if (p.at <= now && (day === null || p.day > day)) day = p.day;
  return day;
}

/** The next planned reminder still to come, if any (for the settings screen). */
export function upcoming(state: ReminderState, now: Millis): Millis | null {
  const next = state.scheduled.filter((p) => p.at > now).sort((a, b) => a.at - b.at)[0];
  return next?.at ?? null;
}

/** The rule's input from the device: this phone's switch, the account's hour and mode. */
export function planFromFacts(
  facts: ReminderFacts,
  state: ReminderState,
  now: Millis,
): PlannedReminder[] {
  if (!state.enabled) return [];
  const pref = parseNotify(facts.settings.notify);
  return planReminders({
    candidate: {
      timezone: facts.settings.timezone,
      day_start_hour: facts.settings.day_start_hour,
      notify: { enabled: true, mode: pref?.mode ?? 'auto', hour: pref?.hour ?? null },
      vacation: facts.settings.vacation ?? null,
      last_review_at: facts.lastReviewAt,
      last_push_day: shownDay(state, now),
    },
    dueTimes: facts.dueTimes,
    secPerCard: facts.secPerCard,
    now,
  });
}

export interface RescheduleDeps {
  port: NotifierPort;
  facts?: (now: Millis) => Promise<ReminderFacts>;
  /** One due card (or null) per planned time; default from the local database. */
  cards?: (ats: Millis[]) => Promise<(ReminderCard | null)[]>;
  now?: () => Millis;
}

/** The cards for the planned reminders; a failed lookup only means plain reminders. */
async function cardsFor(deps: RescheduleDeps, state: ReminderState, plans: PlannedReminder[]) {
  if (!state.answerCards || plans.length === 0) return plans.map(() => null);
  try {
    const list = await (deps.cards ?? getReminderCards)(plans.map((p) => p.at));
    return plans.map((_, i) => list[i] ?? null);
  } catch {
    return plans.map(() => null);
  }
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Replaces the planned reminders with what the rule allows now (or none). Runs after every
 * answer, when the app comes to the foreground and when the setting changes. Serialised.
 */
export function rescheduleReminder(deps: RescheduleDeps): Promise<PlannedReminder[]> {
  const run = async () => {
    const now = (deps.now ?? Date.now)();
    const state = readReminderState();
    const lastShownDay = shownDay(state, now);
    await deps.port.cancel(REMINDER_IDS);
    if (!state.enabled) {
      writeReminderState({ scheduled: [], lastShownDay });
      return [];
    }
    const facts = await (deps.facts ?? getReminderFacts)(now);
    const plans = planFromFacts(facts, state, now);
    // Studied today: a reminder shown today has done its job.
    const cfg = dayConfig(facts.settings);
    if (facts.lastReviewAt !== null && dayKeyOf(facts.lastReviewAt, cfg) === dayKeyOf(now, cfg))
      await deps.port.clearShown(REMINDER_IDS).catch(() => {});
    const cards = await cardsFor(deps, state, plans);
    if (plans.length)
      await deps.port.schedule(
        plans.map((p, i) => {
          const card = cards[i];
          return {
            id: REMINDER_ID + i,
            at: p.at,
            title: p.message.title,
            body: p.message.body,
            url: p.message.url,
            ...(card ? { card: { card_id: card.card_id, term: card.term, meaning: card.meaning } } : {}),
          };
        }),
      );
    writeReminderState({ scheduled: plans.map((p) => ({ day: p.day, at: p.at })), lastShownDay });
    return plans;
  };
  const next = queue.then(run, run);
  queue = next.catch(() => {});
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

/** "Bildirimden cevap ver": whether the reminder asks a card. Replans at once. */
export async function setAnswerCards(on: boolean, deps: RescheduleDeps): Promise<void> {
  writeReminderState({ answerCards: on });
  if (readReminderState().enabled) await rescheduleReminder(deps);
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
