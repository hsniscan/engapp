/// <reference types="vite-plugin-pwa/client" />
// Service worker registration (registerType 'prompt'). A new version never reloads the page
// on its own: the user taps "Yenile" on the toast, and the toast is held back while a review
// session (/review) is open so a session is never interrupted.
import { registerSW } from 'virtual:pwa-register';
import i18n from '@/i18n';
import { toast } from '@/ui';
import { router } from './router';

const inReview = (path: string) => path === '/review' || path.startsWith('/review/');

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  let waiting = false;
  let toastId: string | null = null;

  const show = () => {
    if (!waiting || toastId || inReview(router.state.location.pathname)) return;
    toastId = toast({
      title: i18n.t('pwa.updateReady'),
      tone: 'neutral',
      duration: Infinity,
      action: { label: i18n.t('pwa.reload'), altText: i18n.t('pwa.reloadAlt'), onClick: () => void updateSW(true) },
    });
  };

  router.subscribe((state) => {
    if (inReview(state.location.pathname)) {
      if (toastId) toast.dismiss(toastId);
      toastId = null;
    } else show();
  });

  const updateSW = registerSW({
    onNeedRefresh() {
      waiting = true;
      show();
    },
    onOfflineReady() {
      toast({ title: i18n.t('pwa.offlineReady'), tone: 'success' });
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      // Look for a new version every hour while the app stays open.
      setInterval(() => void registration.update().catch(() => {}), 60 * 60 * 1000);
    },
    onRegisterError(e: unknown) {
      console.warn('Service worker registration failed', e);
    },
  });
}
