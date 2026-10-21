import { useSyncExternalStore } from 'react';

const MINUTE = 60_000;

function subscribe(onChange: () => void): () => void {
  const id = setInterval(onChange, MINUTE);
  return () => clearInterval(id);
}

const snapshot = () => Math.floor(Date.now() / MINUTE) * MINUTE;

/** The current time, rounded to the minute and refreshed every minute (for "9 gün önce" labels). */
export function useNow(): number {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
