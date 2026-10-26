// "Engapp" in Android's text-selection menu (v0.5 İP4, docs/decisions/0046-quick-capture.md).
// Loaded only inside the Android app (quickHost.ts and start.ts import it on demand).
//
// QuickCaptureActivity (ACTION_PROCESS_TEXT) runs its own WebView that starts on /quick; the
// ShareTarget plugin there delivers the selection as `processTextReceived` (retained until this
// listener is added, so a cold start loses nothing) and the sheet opens on /quick?text=….
// The selection is only read: Engapp never returns text to the calling app, and a read-only
// field (EXTRA_PROCESS_TEXT_READONLY) changes nothing.
import { router } from '@/app/router';
import { isOpenablePath, quickHref } from '@/features/quick/route';
import { ShareTarget, type OpenPathIntent, type ProcessTextIntent } from './share';

type Navigate = (to: string, opts?: { replace?: boolean }) => Promise<void> | void;

export async function hostIsQuick(): Promise<boolean> {
  try {
    return (await ShareTarget.host()).quick === true;
  } catch {
    return false;
  }
}

export async function finishQuick(): Promise<boolean> {
  try {
    await ShareTarget.finishQuick();
    return true;
  } catch {
    return false;
  }
}

export async function openInApp(
  target: { path: string } | { shareText: string },
): Promise<boolean> {
  if ('path' in target && !isOpenablePath(target.path)) return false;
  try {
    await ShareTarget.openInApp(target);
    return true;
  } catch {
    return false;
  }
}

const seenText = new Set<string>();

/** Quick activity: a selection (cold start or onNewIntent) opens the sheet on it, once. */
export function openProcessText(
  data: ProcessTextIntent,
  navigate: Navigate = router.navigate,
): void {
  if (!data || seenText.has(data.id)) return;
  seenText.add(data.id);
  void navigate(quickHref(data.text), { replace: true });
}

const seenPath = new Set<string>();

/** Main app: an address the quick sheet handed over (only reader/add addresses). */
export function openPath(data: OpenPathIntent, navigate: Navigate = router.navigate): void {
  if (!data || seenPath.has(data.id) || !isOpenablePath(data.path)) return;
  seenPath.add(data.id);
  void navigate(data.path);
}

let started = false;

export async function startQuickHost(): Promise<void> {
  if (started) return;
  started = true;
  await ShareTarget.addListener('processTextReceived', (d) => openProcessText(d));
}
