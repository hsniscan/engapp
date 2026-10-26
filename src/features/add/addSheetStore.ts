// The Add sheet ("Ne eklemek istersin?") is a modal, not a route: the (+) of the tab bar opens
// it, and any screen may too (an empty home, the Desteler header). One instance lives in the
// root layout; this tiny store is how the rest of the app asks it to open.
import { useSyncExternalStore } from 'react';
import { LIMITS } from '@/domain/limits';

let open = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function setAddSheetOpen(next: boolean): void {
  if (open === next) return;
  open = next;
  emit();
}

export function openAddSheet(): void {
  setAddSheetOpen(true);
}

export function closeAddSheet(): void {
  setAddSheetOpen(false);
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useAddSheetOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => open,
    () => false,
  );
}

/** Where the quick add goes: the add form with the word filled in (it looks the word up). */
export function quickAddHref(term: string): string {
  const clean = term.trim().slice(0, LIMITS.term);
  return clean ? `/add?term=${encodeURIComponent(clean)}` : '/add';
}
