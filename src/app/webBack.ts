// Browser/PWA back with a dialog or sheet open (ADR 0090). The Android app closes the top
// overlay on its back button (src/native/start.ts); the web has no back-button event, only
// history. So each dialog or sheet that opens pushes one entry for the same URL (a copy of
// react-router's state plus a depth mark, so the router sees no change), and Back pops it: we
// close the top overlay instead of leaving the page. Closing it another way (×, Escape, a
// button) takes its entry back off, unless the close came with a navigation, whose own entry
// then sits on top.
import { closeTopOverlay } from '@/native/backButton';

/** Dialogs and sheets only: menus and select lists stay a plain Escape/tap-outside affair. */
const SELECTOR = '[role="dialog"][data-state="open"],[role="alertdialog"][data-state="open"]';
const MARK = 'engappOverlay';

export interface WebBackDeps {
  win?: Window;
  /** True while the router is loading or submitting a navigation. */
  navigating: () => boolean;
  /** Called on every router change, so pushes (which fire no popstate) are seen too. */
  subscribe: (fn: () => void) => () => void;
}

type HistState = Record<string, unknown> & { idx?: number };

/** How many overlay entries of ours are stacked on the current entry (0 = a plain entry). */
export function overlayDepth(state: unknown): number {
  const v = (state as Record<string, unknown> | null)?.[MARK];
  return typeof v === 'number' ? v : 0;
}

export function startWebBack({ win = window, navigating, subscribe }: WebBackDeps): () => void {
  const doc = win.document;
  const state = () => (win.history.state ?? null) as HistState | null;
  const count = () => doc.querySelectorAll(SELECTOR).length;
  let open = count();
  let toRemove = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** Our own history.go() calls, whose popstate is not a Back press. */
  let ownPops = 0;
  let lastIdx = state()?.idx ?? 0;

  const goBack = (n: number) => {
    ownPops++;
    win.history.go(-n);
  };

  // Deferred a tick and checked again: a button that closes the sheet and then navigates must
  // not have its new page undone by our back step.
  const removeEntries = () => {
    timer = undefined;
    const n = Math.min(toRemove, overlayDepth(state()));
    toRemove = 0;
    if (n > 0 && !navigating()) goBack(n);
  };

  const sync = () => {
    const now = count();
    if (now > open) {
      for (let i = open; i < now; i++) {
        const s = state() ?? {};
        win.history.pushState({ ...s, [MARK]: overlayDepth(s) + 1 }, '', win.location.href);
      }
    } else if (now < open && overlayDepth(state()) > 0) {
      toRemove += open - now;
      timer ??= setTimeout(removeEntries, 0);
    }
    open = now;
  };

  const onPop = () => {
    const s = state();
    const idx = s?.idx ?? 0;
    const from = lastIdx;
    lastIdx = idx;
    if (ownPops > 0) {
      ownPops--;
      return;
    }
    if (count() > 0) {
      // Back with a dialog or sheet open: this pop took its entry off; close the top one.
      // Counting it closed now keeps its close from going back a second time.
      closeTopOverlay(doc);
      open = Math.max(0, count() - 1);
      return;
    }
    // Back from a page opened inside an overlay lands on the overlay's old entry (same page,
    // nothing open): step over it, so the next Back is not a dead press.
    const depth = overlayDepth(s);
    if (depth > 0 && idx < from) goBack(depth);
  };

  const observer = new MutationObserver(sync);
  observer.observe(doc.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['data-state'],
  });
  // Read a tick later: the router may tell subscribers before it pushes the entry, and during
  // a popstate the update must land after onPop has read the entry it came from.
  const unsubscribe = subscribe(() => {
    setTimeout(() => {
      lastIdx = state()?.idx ?? lastIdx;
    }, 0);
  });
  win.addEventListener('popstate', onPop, true);
  return () => {
    observer.disconnect();
    unsubscribe();
    if (timer) clearTimeout(timer);
    win.removeEventListener('popstate', onPop, true);
  };
}
