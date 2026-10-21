import { useSyncExternalStore } from 'react';
import { SyncStatus } from '@/ui';

function subscribe(cb: () => void) {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}

/**
 * Placeholder until the sync engine (src/sync) exposes its state: shows only online/offline.
 * Replace the body with the engine's store; keep <SyncStatus> as the view.
 */
export function SyncIndicator() {
  const online = useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
  return <SyncStatus state={online ? 'synced' : 'offline'} />;
}
