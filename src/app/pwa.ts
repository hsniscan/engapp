/// <reference types="vite-plugin-pwa/client" />
// Service worker registration (registerType 'prompt'). A new version never reloads the page
// on its own: the user taps "Yenile" on the toast, and the toast is held back while a review
// session (/study, or its old address /review) is open so a session is never interrupted.
// "Yenile" activates the waiting worker itself and reloads once it has taken over
// (src/app/swUpdate.ts): Workbox's own updateSW(true) could reload with the old worker still
// waiting, so a web user stayed on an old version (review 2026-11-26, #13).
import { registerSW } from 'virtual:pwa-register';
import { watchDbReplaced } from '@/data';
import i18n from '@/i18n';
import { toast } from '@/ui';
import { router } from './router';
import { activateWaitingAndReload, watchForUpdates } from './swUpdate';

const inReview = (path: string) =>
  ['/study', '/review', '/practice'].some((p) => path === p || path.startsWith(`${p}/`));

/** Activates a waiting service worker (if any) and reloads; set by registerServiceWorker. */
let reloadToLatest: (() => void) | null = null;

/**
 * A newer version in another tab upgraded the database (ADR 0064): this page's connection is
 * closed, so it asks for a reload instead of failing on the next query. If that version's
 * service worker is still waiting, the reload activates it first, so the page does not come
 * back with the old code.
 */
export function watchSchemaReplaced(): void {
  watchDbReplaced(() => {
    toast({
      title: i18n.t('pwa.dbReplacedTitle'),
      description: i18n.t('pwa.dbReplaced'),
      tone: 'warn',
      duration: Infinity,
      action: {
        label: i18n.t('pwa.reload'),
        altText: i18n.t('pwa.reloadAlt'),
        onClick: () => (reloadToLatest ? reloadToLatest() : window.location.reload()),
      },
    });
  });
}

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  let waiting = false;
  let toastId: string | null = null;
  let registration: ServiceWorkerRegistration | null = null;

  const applyUpdate = async () => {
    const reg = registration ?? (await navigator.serviceWorker.getRegistration().catch(() => undefined));
    activateWaitingAndReload(reg);
  };

  const show = () => {
    if (!waiting || toastId || inReview(router.state.location.pathname)) return;
    toastId = toast({
      title: i18n.t('pwa.updateReady'),
      tone: 'neutral',
      duration: Infinity,
      action: {
        label: i18n.t('pwa.reload'),
        altText: i18n.t('pwa.reloadAlt'),
        onClick: () => void applyUpdate(),
      },
    });
  };

  // A tapped reminder while the app is open (public/push-sw.js): route in place, no reload.
  navigator.serviceWorker.addEventListener('message', (e: MessageEvent) => {
    const data = e.data as { type?: unknown; url?: unknown } | null;
    if (
      data?.type === 'engapp:navigate' &&
      typeof data.url === 'string' &&
      data.url.startsWith('/')
    )
      void router.navigate(data.url);
  });

  router.subscribe((state) => {
    if (inReview(state.location.pathname)) {
      if (toastId) toast.dismiss(toastId);
      toastId = null;
    } else show();
  });

  registerSW({
    onNeedRefresh() {
      waiting = true;
      show();
    },
    onOfflineReady() {
      toast({ title: i18n.t('pwa.offlineReady'), tone: 'success' });
    },
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      registration = reg;
      // Now, every hour, and whenever the app comes back to the foreground.
      watchForUpdates(reg);
    },
    onRegisterError(e: unknown) {
      console.warn('Service worker registration failed', e);
    },
  });
  reloadToLatest = () => {
    if (waiting) void applyUpdate();
    else window.location.reload();
  };
}
