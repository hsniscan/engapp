// The Android app's reminder on @capacitor/local-notifications (docs/decisions/0033-android-capacitor.md).
// Implements NotifierPort for src/features/notify/nativeReminder.ts and keeps the plan current:
// after every answer (a new review row), when settings change, when the app comes back to the
// foreground and when the signed-in account changes. A tap on the reminder opens /study.
import { liveQuery } from 'dexie';
import { App } from '@capacitor/app';
import { LocalNotifications } from '@capacitor/local-notifications';
import { router } from '@/app/router';
import { db, logError } from '@/data';
import { getAuthState, onUserChange } from '@/features/auth/session';
import {
  readReminderState,
  REMINDER_CHANNEL,
  rescheduleReminder,
  syncWebPushCleanup,
  type NotifierPort,
  type Permission,
  type WebPushCleaner,
} from '@/features/notify/nativeReminder';
import i18n from '@/i18n';
import { getSession, loadSupabase } from '@/lib/supabase';
import { ReminderAnswers, type CardReminderPayload } from './widget';

const toPermission = (p: string): Permission =>
  p === 'granted' ? 'granted' : p === 'denied' ? 'denied' : 'prompt';

export const capacitorNotifier: NotifierPort = {
  async checkPermission() {
    return toPermission((await LocalNotifications.checkPermissions()).display);
  },
  async requestPermission() {
    // Android 13+ shows the system "Allow notifications?" dialog; older versions answer granted.
    return toPermission((await LocalNotifications.requestPermissions()).display);
  },
  async ensureChannel() {
    await LocalNotifications.createChannel({
      id: REMINDER_CHANNEL,
      name: i18n.t('native.reminders.channelName'),
      description: i18n.t('native.reminders.channelDescription'),
      importance: 3, // default: sound, no heads-up
      visibility: 1,
    });
  },
  async schedule(list) {
    // A reminder that asks a card is planned by the app's own ReminderAnswers plugin: its
    // buttons ("Cevabı gör", "Bildim", "Bilemedim") work without opening the app, which the
    // local-notifications plugin cannot do (its buttons always open the app). ADR 0048.
    const asking = list.filter((n) => n.card);
    const plain = list.filter((n) => !n.card);
    if (asking.length)
      await ReminderAnswers.schedule({
        notifications: asking.map(
          (n): CardReminderPayload => ({
            id: n.id,
            at: n.at,
            title: n.title,
            body: n.body,
            url: n.url,
            channelId: REMINDER_CHANNEL,
            card: {
              card_id: n.card!.card_id,
              question: i18n.t('widget.notify.question', { term: n.card!.term }),
              answer: i18n.t('widget.notify.answer', { term: n.card!.term, meaning: n.card!.meaning }),
            },
            labels: {
              reveal: i18n.t('widget.notify.reveal'),
              knew: i18n.t('widget.notify.knew'),
              forgot: i18n.t('widget.notify.forgot'),
              saved: i18n.t('widget.notify.saved'),
            },
          }),
        ),
      });
    if (!plain.length) return;
    await LocalNotifications.schedule({
      notifications: plain.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        channelId: REMINDER_CHANNEL,
        smallIcon: 'ic_stat_engapp',
        autoCancel: true,
        extra: { url: n.url },
        // Inexact: a daily nudge does not need the exact-alarm permission (removed in the
        // manifest; Play allows it only for alarm and calendar apps).
        isExactNotification: false,
        schedule: { at: new Date(n.at), allowWhileIdle: true },
      })),
    });
  },
  async cancel(ids) {
    await Promise.all([
      LocalNotifications.cancel({ notifications: ids.map((id) => ({ id })) }),
      ReminderAnswers.cancel({ ids }),
    ]);
  },
  async clearShown(ids) {
    await Promise.all([
      LocalNotifications.removeDeliveredNotificationsById({ ids }),
      ReminderAnswers.clearShown({ ids }),
    ]);
  },
};

/** Removes every Web Push subscription of the signed-in account (own rows, RLS). */
export const removeAccountWebPush: WebPushCleaner = async () => {
  // Only a signed-in device has web push rows of its own to drop.
  if (!(await getSession())) return 0;
  const supabase = await loadSupabase();
  if (!supabase) return 0;
  const { data, error } = await supabase.from('push_subscriptions').select('endpoint');
  if (error) return null;
  let removed = 0;
  for (const row of (data ?? []) as { endpoint: string }[]) {
    const r = await supabase.rpc('push_unsubscribe', { p_endpoint: row.endpoint });
    if (r.error) return null;
    removed++;
  }
  return removed;
};

const deps = { port: capacitorNotifier };

function reschedule(where: string): void {
  if (!readReminderState().enabled) return;
  rescheduleReminder(deps).catch((e: unknown) => void logError(e, where));
}

let timer: ReturnType<typeof setTimeout> | null = null;
function soon(where: string, ms = 1500): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    reschedule(where);
  }, ms);
}

let started = false;

export async function startNativeReminders(): Promise<void> {
  if (started) return;
  started = true;

  await LocalNotifications.addListener('localNotificationActionPerformed', (a) => {
    const url = (a.notification.extra as { url?: unknown } | undefined)?.url;
    void router.navigate(typeof url === 'string' && url.startsWith('/') ? url : '/study');
  });

  // A new answer or a settings change (hour, mode, time zone, vacation) changes the plan.
  liveQuery(async () => {
    const [last, settings] = await Promise.all([
      db.review_logs.orderBy('reviewed_at').last(),
      db.settings.get('settings'),
    ]);
    return `${last?.id ?? ''}|${settings?.updated_at ?? ''}`;
  }).subscribe({
    next: () => soon('reminders.change'),
    error: (e: unknown) => void logError(e, 'reminders.watch'),
  });

  await App.addListener('resume', () => {
    soon('reminders.resume', 300);
    const user = getAuthState().user;
    void syncWebPushCleanup(user?.id ?? null, removeAccountWebPush);
  });

  onUserChange((user) => {
    void syncWebPushCleanup(user?.id ?? null, removeAccountWebPush);
  });
}
