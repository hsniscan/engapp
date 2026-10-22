// Android back button (docs/decisions/0033-android-capacitor.md): close the open sheet or menu
// first, then go back in the app's history, and leave the app only from the home screen. A screen
// opened without history (a share, a notification) goes to the home screen instead of exiting.

export type BackAction = 'close-overlay' | 'back' | 'home' | 'exit';

export interface BackState {
  /** A dialog, sheet, menu or select list is open. */
  overlayOpen: boolean;
  /** Current route path. */
  path: string;
  /** There is an earlier in-app entry in the history. */
  canGoBack: boolean;
}

export function decideBack(s: BackState): BackAction {
  if (s.overlayOpen) return 'close-overlay';
  if (s.path === '/' || s.path === '') return 'exit';
  if (s.canGoBack) return 'back';
  return 'home';
}

/** Radix overlays (Dialog/sheet, AlertDialog, DropdownMenu, Select) mark themselves open. */
export const OVERLAY_SELECTOR = [
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
  '[role="menu"][data-state="open"]',
  '[role="listbox"][data-state="open"]',
].join(',');

export function overlayOpen(doc: Document = document): boolean {
  return doc.querySelector(OVERLAY_SELECTOR) !== null;
}

/** Radix closes the topmost layer on Escape (listened for on the document). */
export function closeTopOverlay(doc: Document = document): void {
  const target = doc.activeElement ?? doc.body;
  target.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      bubbles: true,
      cancelable: true,
    }),
  );
}

/** react-router keeps the entry's position in history.state.idx (0 = first entry of the app). */
export function historyIndex(state: unknown): number {
  const idx = (state as { idx?: unknown } | null)?.idx;
  return typeof idx === 'number' && Number.isFinite(idx) ? idx : 0;
}
