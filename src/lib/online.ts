// The browser's online state: one subscription helper and one hook for the whole app
// (v0.5.2: replaces the copies in features/import/shared.ts, features/story and sync/status).
import { useSyncExternalStore } from 'react';

export function subscribeOnline(cb: () => void): () => void {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}

export const isOnline = (): boolean => (typeof navigator === 'undefined' ? true : navigator.onLine);

/** Re-renders when the device goes online or offline. Server render: online. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, isOnline, () => true);
}
