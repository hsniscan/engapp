// "Yarın sana hatırlatayım mı?" (v0.5.3 A4, ADR 0072): after the first finished session, Bugün
// offers the daily reminder once, with a time. Android: the phone's own local notification (no
// account needed, decision 0033). Web: Web Push for a signed-in user where the browser supports
// it; a guest is offered an account instead. "Hayır" is final on this device: the offer never
// comes back, and the switch stays in Profil → Ayarlar → Bildirim.
import { useSyncExternalStore } from 'react';
import { saveNotify } from '@/data/notify';
import { clampNotifyHour, LAST_NOTIFY_HOUR } from '@/domain/notify';
import type { Millis } from '@/domain/types';
import { flags } from '@/features/settings/platform';
import { enableReminder, readReminderState, type NotifierPort, type WebPushCleaner } from './nativeReminder';
import { browserPushEnv, enablePush, type EnableResult as WebEnableResult, pushSupport, type PushEnv } from './push';

export const REMINDER_OFFER_KEY = 'reminderOffer';
/** Notification id of the one-off "the cards are ready" ping (the daily ones are 1001…). */
export const STEP_PING_ID = 1090;

export type OfferAnswer = 'yes' | 'no';
export type OfferKind = 'native' | 'web' | 'webGuest';

const listeners = new Set<() => void>();
const answerSnapshot = (): string => flags.get(REMINDER_OFFER_KEY) ?? '';

export function answerOffer(answer: OfferAnswer): void {
  flags.set(REMINDER_OFFER_KEY, answer);
  for (const l of [...listeners]) l();
}

export function useOfferAnswer(): OfferAnswer | null {
  const v = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    answerSnapshot,
    answerSnapshot,
  );
  return v === 'yes' || v === 'no' ? v : null;
}

/** Pure: whether Bugün offers the reminder now, and which kind. */
export function offerKind(input: {
  answered: OfferAnswer | null;
  /** Answers given on this device or account (the first session is finished once there are some). */
  answers: number;
  /** Today's study has no card ready right now (the session just ended). */
  sessionOver: boolean;
  native: boolean;
  nativeEnabled: boolean;
  webSupported: boolean;
  signedIn: boolean;
  /** settings.notify.enabled (the account already has a reminder). */
  accountEnabled: boolean;
  backend: boolean;
}): OfferKind | null {
  if (input.answered !== null || input.answers === 0 || !input.sessionOver) return null;
  if (input.native) return input.nativeEnabled ? null : 'native';
  if (!input.backend || !input.webSupported || input.accountEnabled) return null;
  return input.signedIn ? 'web' : 'webGuest';
}

/** The hour the offer suggests: the hour the user just studied, inside the allowed window. */
export function suggestedHour(now: Millis, timezone: string): number {
  const h = Number(
    new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: timezone }).format(
      new Date(now),
    ),
  );
  // After midnight counts as late evening (the window ends at 21), early morning as morning.
  return h < 5 ? LAST_NOTIFY_HOUR : clampNotifyHour(h);
}

export interface NativeDeps {
  port: NotifierPort;
  cleanWebPush: WebPushCleaner;
}

export async function loadNativeDeps(): Promise<NativeDeps> {
  const m = await import('@/native/reminders');
  return { port: m.capacitorNotifier, cleanWebPush: m.removeAccountWebPush };
}

export type TurnOnResult = { ok: true } | { ok: false; reason: 'denied' | 'error' | WebEnableResult };

/** "Evet": saves the hour (synced), then turns this device's reminder on. Asks permission here. */
export async function turnOnReminder(
  kind: 'native' | 'web',
  hour: number,
  opts: { userId: string | null; native?: () => Promise<NativeDeps>; env?: PushEnv },
): Promise<TurnOnResult> {
  if (kind === 'native') {
    await saveNotify({ mode: 'fixed', hour });
    const d = await (opts.native ?? loadNativeDeps)();
    const r = await enableReminder({ port: d.port, userId: opts.userId, cleanWebPush: d.cleanWebPush });
    return r.ok ? { ok: true } : { ok: false, reason: r.reason };
  }
  if (!opts.userId) return { ok: false, reason: 'error' };
  const env = opts.env ?? browserPushEnv();
  const r = await enablePush(opts.userId, env);
  if (r !== 'ok') return { ok: false, reason: r };
  await saveNotify({ enabled: true, mode: 'fixed', hour });
  return { ok: true };
}

export function webPushSupported(env: PushEnv = browserPushEnv()): boolean {
  return pushSupport(env) === 'supported';
}

export function nativeReminderOn(): boolean {
  return readReminderState().enabled;
}

/**
 * "Hazır olunca haber ver" (A6): one local notification when the waiting learning steps are due.
 * Android only; asks the notification permission here.
 */
export async function pingWhenDue(
  at: Millis,
  text: { title: string; body: string },
  native: () => Promise<NativeDeps> = loadNativeDeps,
): Promise<boolean> {
  const { port } = await native();
  let perm = await port.checkPermission();
  if (perm !== 'granted') perm = await port.requestPermission();
  if (perm !== 'granted') return false;
  await port.ensureChannel();
  await port.cancel([STEP_PING_ID]);
  await port.schedule([{ id: STEP_PING_ID, at, title: text.title, body: text.body, url: '/study?mode=word' }]);
  return true;
}
