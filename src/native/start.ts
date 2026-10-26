// Startup of the Android app (Capacitor), loaded by main.tsx only when isNativeApp() is true, in
// place of the service worker (docs/decisions/0033-android-capacitor.md). Web Push, the install
// prompt and the service worker do not exist here; their native counterparts are wired below.
import { SystemBars, SystemBarsStyle } from '@capacitor/core';
import { App } from '@capacitor/app';
import { router } from '@/app/router';
import { logError } from '@/data';
import { closeTopOverlay, decideBack, historyIndex, overlayOpen } from './backButton';

let started = false;

/** Status bar icons follow the app theme (the bar itself shows the page canvas edge-to-edge). */
function startSystemBars(): void {
  const apply = () => {
    // <html data-theme> holds the preference (src/ui/theme); 'system' follows the OS.
    const pref = document.documentElement.dataset.theme;
    const isDark =
      pref === 'dark' ||
      (pref !== 'light' &&
        typeof matchMedia === 'function' &&
        matchMedia('(prefers-color-scheme: dark)').matches);
    // Style "Dark" = light icons for a dark background.
    void SystemBars.setStyle({
      style: isDark ? SystemBarsStyle.Dark : SystemBarsStyle.Light,
    }).catch(() => {});
  };
  apply();
  new MutationObserver(apply).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  if (typeof matchMedia === 'function')
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', apply);
}

function startBackButton(): void {
  void App.addListener('backButton', () => {
    const action = decideBack({
      overlayOpen: overlayOpen(),
      path: router.state.location.pathname,
      canGoBack: historyIndex(window.history.state) > 0,
    });
    if (action === 'close-overlay') closeTopOverlay();
    else if (action === 'back') void router.navigate(-1);
    else if (action === 'home') void router.navigate('/', { replace: true });
    else void App.exitApp();
  });
}

export async function startNative(): Promise<void> {
  if (started) return;
  started = true;
  document.documentElement.dataset.native = 'android';
  // The text-selection sheet's own activity (decision 0046): only the selection and the back
  // button; reminders, system bar styling and shares belong to the main app.
  const quick = await import('./quick');
  if (await quick.hostIsQuick()) {
    void App.addListener('backButton', () => void quick.finishQuick());
    await quick.startQuickHost().catch((e: unknown) => void logError(e, 'native.quick'));
    return;
  }
  startSystemBars();
  startBackButton();
  const tasks: [string, () => Promise<unknown>][] = [
    ['native.share', async () => (await import('./share')).startShareTarget()],
    ['native.reminders', async () => (await import('./reminders')).startNativeReminders()],
  ];
  for (const [where, run] of tasks) await run().catch((e: unknown) => void logError(e, where));
}
