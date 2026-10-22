// "Paylaş → Engapp" in the Android app (docs/decisions/0034-share-target.md). The app-local
// ShareTarget plugin (android/app/src/main/java/.../ShareTargetPlugin.java) sends every
// ACTION_SEND text/plain intent as `shareReceived`; a share that started the app (cold start) is
// held until this listener is added, a share into the running app (warm start) arrives at once.
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { router } from '@/app/router';
import { shareHref } from '@/features/share/route';

export interface SharedIntent {
  id: string;
  text: string;
  title: string;
}

interface ShareTargetPlugin {
  addListener(
    event: 'shareReceived',
    cb: (data: SharedIntent) => void,
  ): Promise<PluginListenerHandle>;
}

const ShareTarget = registerPlugin<ShareTargetPlugin>('ShareTarget');

const seen = new Set<string>();

/** Opens /share for a received intent (once per intent id). */
export function openShared(data: SharedIntent, navigate = router.navigate): void {
  if (!data || seen.has(data.id)) return;
  seen.add(data.id);
  void navigate(shareHref(data));
}

let started = false;

export async function startShareTarget(): Promise<void> {
  if (started) return;
  started = true;
  await ShareTarget.addListener('shareReceived', (d) => openShared(d));
}
