// "Paylaş → Engapp" in the Android app (docs/decisions/0034-share-target.md). The app-local
// ShareTarget plugin (android/app/src/main/java/.../ShareTargetPlugin.java) sends every
// ACTION_SEND text/plain intent as `shareReceived`; a share that started the app (cold start) is
// held until this listener is added, a share into the running app (warm start) arrives at once.
//
// The same plugin serves the text-selection menu (v0.5 İP4, docs/decisions/0046): see quick.ts.
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { router } from '@/app/router';
import { shareHref } from '@/features/share/route';

export interface SharedIntent {
  id: string;
  text: string;
  title: string;
}

/** ACTION_PROCESS_TEXT ("Engapp" in the selection menu); delivered to QuickCaptureActivity. */
export interface ProcessTextIntent {
  id: string;
  text: string;
  /** The calling app's field is read-only. Engapp never writes text back either way. */
  readonly: boolean;
}

/** An in-app address the quick sheet asked the main app to open (validated natively too). */
export interface OpenPathIntent {
  id: string;
  path: string;
}

export interface ShareTargetPlugin {
  addListener(
    event: 'shareReceived',
    cb: (data: SharedIntent) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: 'processTextReceived',
    cb: (data: ProcessTextIntent) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: 'openPathReceived',
    cb: (data: OpenPathIntent) => void,
  ): Promise<PluginListenerHandle>;
  /** Which activity this WebView lives in: the translucent quick sheet or the main app. */
  host(): Promise<{ quick: boolean }>;
  /** Closes the quick sheet's activity (back to the calling app). No-op in the main app. */
  finishQuick(): Promise<void>;
  /** Opens the main app on `path`, or shares `shareText` into it; then closes the quick sheet. */
  openInApp(options: { path?: string; shareText?: string }): Promise<void>;
}

export const ShareTarget = registerPlugin<ShareTargetPlugin>('ShareTarget');

const seen = new Set<string>();

/** Opens /share for a received intent (once per intent id). */
export function openShared(data: SharedIntent, navigate = router.navigate): void {
  if (!data || seen.has(data.id)) return;
  seen.add(data.id);
  void navigate(shareHref(data));
}

let started = false;

/** Main app: shares, and addresses the quick sheet hands over ("Okuyucuda aç"). */
export async function startShareTarget(): Promise<void> {
  if (started) return;
  started = true;
  await ShareTarget.addListener('shareReceived', (d) => openShared(d));
  const { openPath } = await import('./quick');
  await ShareTarget.addListener('openPathReceived', (d) => openPath(d));
}
