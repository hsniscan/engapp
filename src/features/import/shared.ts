import { useLiveQuery } from 'dexie-react-hooks';
import { useSyncExternalStore } from 'react';
import { getSettings } from '@/data';

/** Longest text accepted in one import (~50 chunks; the daily AI budget is the real limit). */
export const MAX_IMPORT_CHARS = 300_000;

/** The user's CEFR level from settings (AI skips words below it). */
export function useImportLevel() {
  return useLiveQuery(async () => (await getSettings()).level, []) ?? 'B1';
}

function subscribeOnline(cb: () => void) {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

/** "After years of trying, Maria…" → a readable default title. */
export function firstWords(text: string, max = 48): string {
  const line = text.split(/\n/)[0]!.replace(/\s+/g, ' ').trim();
  if (line.length <= max) return line;
  const cut = line.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 24)).trim()}…`;
}
