// Background part of the reminders (v0.3 İP8), started with the connected features:
//   - a browser subscription never outlives its account: after sign-out or another sign-in it
//     is unsubscribed (multi-account rule, decision 0009);
//   - in "auto" mode the stored hour follows the review history (checked at most every 6 h,
//     when the app is opened or comes back to the foreground);
// (A tap on a notification while the app is open is routed in src/app/pwa.ts.)
import { logError } from '@/data';
import { refreshAutoHour } from '@/data/notify';
import { onUserChange } from '@/features/auth/session';
import { dropForeignSubscription } from './push';

const REFRESH_EVERY_MS = 6 * 3600_000;
let started = false;
let lastRefresh = 0;
let signedIn = false;

function maybeRefresh(now = Date.now()): void {
  if (!signedIn || now - lastRefresh < REFRESH_EVERY_MS) return;
  lastRefresh = now;
  refreshAutoHour(now).catch((e: unknown) => void logError(e, 'notify.autoHour'));
}

export function startPushFeatures(): void {
  if (started) return;
  started = true;
  onUserChange((user) => {
    signedIn = !!user;
    dropForeignSubscription(user?.id ?? null).catch(() => {});
    if (user) setTimeout(() => maybeRefresh(), 5_000);
  });
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') maybeRefresh();
    });
  }
}
