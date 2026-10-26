// The quick sheet's host (v0.5 İP4, docs/decisions/0046-quick-capture.md), without importing
// Capacitor: the /quick route stays in the web bundle and loads the native side only inside the
// Android app.
//
// On Android "Engapp" in the text-selection menu starts QuickCaptureActivity, a translucent
// activity with its own WebView whose start address is /quick: the calling app stays visible
// behind the sheet, and closing the sheet finishes that activity (back to the calling app). In
// the browser the same route is a page: closing it goes back in history.
import { isNativeApp } from './platform';

/** Start address of QuickCaptureActivity (android/.../QuickConfig.java). */
export const QUICK_START_PATH = '/quick';

/**
 * Synchronous guess at boot, used to paint the page transparent before the first frame:
 * the native app was started on /quick (the main activity always starts on /).
 */
export function bootedAsQuickHost(
  loc: Pick<Location, 'pathname'> = location,
  native: boolean = isNativeApp(),
): boolean {
  return native && loc.pathname === QUICK_START_PATH;
}

let hostCheck: Promise<boolean> | null = null;

/** True inside QuickCaptureActivity (asked of the plugin once). */
export function isQuickHost(): Promise<boolean> {
  if (!isNativeApp()) return Promise.resolve(false);
  hostCheck ??= import('./quick').then((m) => m.hostIsQuick()).catch(() => false);
  return hostCheck;
}

/** Close the sheet: finish the activity (Android) or `fallback` (web: go back). */
export async function closeQuick(fallback: () => void): Promise<void> {
  if (await isQuickHost()) {
    const ok = await import('./quick').then((m) => m.finishQuick()).catch(() => false);
    if (ok) return;
  }
  fallback();
}

/**
 * Continue in the full app: an in-app `path` or a text to extract words from (`shareText`,
 * the "Paylaş → Engapp" flow). Inside the quick activity the main app opens and the sheet
 * closes; on the web `fallback` navigates in place.
 */
export async function continueInApp(
  target: { path: string } | { shareText: string },
  fallback: () => void,
): Promise<void> {
  if (await isQuickHost()) {
    const ok = await import('./quick').then((m) => m.openInApp(target)).catch(() => false);
    if (ok) return;
  }
  fallback();
}
