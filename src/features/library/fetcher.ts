// Keeping the graded library's catalogue on the device (decision 0047). For a signed-in user
// it is pulled in the background after every successful sync and when the device comes back
// online; anyone (guests too: the catalogue is public) pulls it by opening the library. A
// guest's device otherwise never talks to the backend. The pull itself skips while the copy is
// fresh (data/library.ts GRADED_REFRESH_MS).
import { kickGradedCatalogPull } from '@/data/library';
import { getAccessToken, isBackendConfigured } from '@/lib/supabase';
import { engine } from '@/sync/instance';

let started = false;

async function kickIfSignedIn(): Promise<void> {
  if (!isBackendConfigured() || (await getAccessToken()) === null) return;
  await kickGradedCatalogPull();
}

export function startGradedCatalog(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.addEventListener('online', () => void kickIfSignedIn());
  let wasRunning = engine.getSnapshot().running;
  engine.subscribe(() => {
    const snap = engine.getSnapshot();
    if (wasRunning && !snap.running && !snap.error) void kickIfSignedIn();
    wasRunning = snap.running;
  });
}
