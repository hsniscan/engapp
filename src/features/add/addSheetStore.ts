// The Add sheet ("Ne eklemek istersin?") is a modal, not a route: the (+) of the tab bar opens
// it, and any screen may too (an empty Bugün, Kelimelerim's "İçe aktar", Metinlerim's "Metin
// ekle"). One instance lives in the root layout; this tiny store is how the rest of the app
// asks it to open, optionally at one of its four groups (v0.5.1, decision 0056).
import { useSyncExternalStore } from 'react';
import { LIMITS } from '@/domain/limits';

/** The sheet's groups, top to bottom. */
export type AddSheetSection = 'word' | 'text' | 'compose' | 'import';

export const ADD_SHEET_SECTIONS: readonly AddSheetSection[] = ['word', 'text', 'compose', 'import'];

interface SheetState {
  open: boolean;
  /** The group to bring into view (and, for 'word', focus); null: the top. */
  section: AddSheetSection | null;
}

let state: SheetState = { open: false, section: null };
const listeners = new Set<() => void>();

function set(next: SheetState) {
  if (next.open === state.open && next.section === state.section) return;
  state = next;
  for (const l of listeners) l();
}

export function setAddSheetOpen(next: boolean): void {
  set(
    next
      ? { open: true, section: state.open ? state.section : null }
      : { open: false, section: null },
  );
}

/** Opens the sheet; with a section, scrolled to that group ('word' also focuses the input). */
export function openAddSheet(section?: AddSheetSection): void;
/** As a click handler (`onClick={openAddSheet}`): the event is ignored, the sheet opens at the top. */
export function openAddSheet(event: { type: string }): void;
export function openAddSheet(section?: unknown): void {
  const s = ADD_SHEET_SECTIONS.find((x) => x === section) ?? null;
  set({ open: true, section: s });
}

export function closeAddSheet(): void {
  set({ open: false, section: null });
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const getState = () => state;
const serverState: SheetState = { open: false, section: null };

export function useAddSheetState(): SheetState {
  return useSyncExternalStore(subscribe, getState, () => serverState);
}

export function useAddSheetOpen(): boolean {
  return useAddSheetState().open;
}

/** The full add form with the word filled in ("Elle düzenle"); it looks the word up too. */
export function quickAddHref(term: string): string {
  const clean = term.trim().slice(0, LIMITS.term);
  return clean ? `/add?term=${encodeURIComponent(clean)}` : '/add';
}
