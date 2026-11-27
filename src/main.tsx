import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import '@/i18n';
import { initTheme } from '@/ui/theme';
import { App } from '@/app/App';
import { bootstrap } from '@/features/settings/bootstrap';
import { registerServiceWorker, watchSchemaReplaced } from '@/app/pwa';
import { router } from '@/app/router';
import { startWebBack } from '@/app/webBack';
import { isNativeApp } from '@/native/platform';
import { bootedAsQuickHost } from '@/native/quickHost';

// Pre-paint cache first (localStorage), then the settings table takes over (bootstrap).
initTheme();
bootstrap();
watchSchemaReplaced();
// The Android app (Capacitor) ships its files inside the APK: no service worker, no Web Push.
// Its native wiring (back button, system bars, share, reminders) loads only there.
if (isNativeApp()) {
  // Text-selection sheet (decision 0046); index.html usually marked it before the first paint.
  if (bootedAsQuickHost()) document.documentElement.dataset.quickHost = 'true';
  void import('@/native/start')
    .then((m) => m.startNative())
    .catch((e: unknown) => console.warn('native start failed', e));
} else {
  registerServiceWorker();
  // Browser/PWA Back closes an open dialog or sheet first (ADR 0090), like the app's back button.
  startWebBack({
    subscribe: (fn) => router.subscribe(fn),
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
