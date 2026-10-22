// The Android app's reminder on @capacitor/local-notifications (docs/decisions/0033-android-capacitor.md).
// Implements NotifierPort for src/features/notify/nativeReminder.ts and keeps the plan current:
// after every answer (a new review row), when settings change, when the app comes back to the
// foreground and when the signed-in account changes. A tap on the reminder opens /review.
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
import { supabase } from '@/lib/supabase';

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
  async schedule(n) {
    await LocalNotifications.schedule({
      notifications: [
        {
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
        },
      ],
    });
  },
  async cancel(id) {
    await LocalNotifications.cancel({ notifications: [{ id }] });
  },
  async clearShown(id) {
    await LocalNotifications.removeDeliveredNotificationsById({ ids: [id] });
  },
};

/** Removes every Web Push subscription of the signed-in account (own rows, RLS). */
export const removeAccountWebPush: WebPushCleaner = async () => {
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
    void router.navigate(typeof url === 'string' && url.startsWith('/') ? url : '/review');
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
