import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import '@/i18n';
import { initTheme } from '@/ui/theme';
import { App } from '@/app/App';
import { bootstrap } from '@/features/settings/bootstrap';
import { registerServiceWorker } from '@/app/pwa';
import { isNativeApp } from '@/native/platform';

// Pre-paint cache first (localStorage), then the settings table takes over (bootstrap).
initTheme();
bootstrap();
// The Android app (Capacitor) ships its files inside the APK: no service worker, no Web Push.
// Its native wiring (back button, system bars, share, reminders) loads only there.
if (isNativeApp()) {
  void import('@/native/start')
    .then((m) => m.startNative())
    .catch((e: unknown) => console.warn('native start failed', e));
} else registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
