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

/** A meaning the lookup found, carried into the full form by "Elle düzenle" (review 2026-11-26 #7). */
export interface QuickAddSense {
  meaning_tr: string;
  pos?: string | null;
  gloss_en?: string | null;
  /** The word bank's / lexicon's own example sentence (never the user's text). */
  example_en?: string | null;
  lexicon_sense_id?: string | null;
}

/** At most this many found meanings travel in the address. */
const MAX_CARRIED = 3;

/**
 * The full add form with the word filled in ("Elle düzenle"); it looks the word up too. The
 * meanings the sheet found (and picked) come along, so the form opens filled, not empty:
 * one m / pos / gl / ex / lid each per meaning, in the same order.
 */
export function quickAddHref(term: string, senses: readonly QuickAddSense[] = []): string {
  const clean = term.trim().slice(0, LIMITS.term);
  if (!clean) return '/add';
  let href = `/add?term=${encodeURIComponent(clean)}`;
  const add = (key: string, value: string) => {
    href += `&${key}=${encodeURIComponent(value)}`;
  };
  for (const s of senses.filter((x) => x.meaning_tr.trim()).slice(0, MAX_CARRIED)) {
    add('m', s.meaning_tr.trim().slice(0, LIMITS.meaning_tr));
    add('pos', s.pos ?? '');
    add('gl', (s.gloss_en ?? '').slice(0, LIMITS.gloss_en));
    add('ex', (s.example_en ?? '').slice(0, LIMITS.source_sentence));
    add('lid', s.lexicon_sense_id ?? '');
  }
  return href;
}

/** The meanings quickAddHref put in the address (none for a plain /add?term=…). */
export function readQuickAddSenses(params: URLSearchParams): QuickAddSense[] {
  const at = (key: string, i: number) => params.getAll(key)[i]?.trim() || null;
  return params
    .getAll('m')
    .slice(0, MAX_CARRIED)
    .map((meaning, i) => ({
      meaning_tr: meaning.trim().slice(0, LIMITS.meaning_tr),
      pos: at('pos', i),
      gloss_en: at('gl', i)?.slice(0, LIMITS.gloss_en) ?? null,
      example_en: at('ex', i)?.slice(0, LIMITS.source_sentence) ?? null,
      lexicon_sense_id: at('lid', i),
    }))
    .filter((s) => s.meaning_tr);
}
