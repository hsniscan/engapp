// Browser/PWA back with a dialog or sheet open (ADR 0090). The Android app closes the top
// overlay on its back button (src/native/start.ts); the web has no back-button event, only
// history. So each dialog or sheet that opens pushes one entry for the same URL (a copy of
// react-router's state plus a depth mark, so the router sees no change), and Back pops it: we
// close the top overlay instead of leaving the page.
//
// An overlay closed another way (×, Escape, a button) leaves its entry behind. Taking it off
// right away (history.go) would race whatever comes next (a link inside the sheet, a typed
// address), so we never move history on our own; instead a later Back that lands on a leftover
// entry carries on to where the learner meant to go, in the same gesture.
import { closeTopOverlay } from '@/native/backButton';

/** Dialogs and sheets only: menus and select lists stay a plain Escape/tap-outside affair. */
const SELECTOR = '[role="dialog"][data-state="open"],[role="alertdialog"][data-state="open"]';
const MARK = 'engappOverlay';

export interface WebBackDeps {
  win?: Window;
  /** Called on every router change, so pushes (which fire no popstate) are seen too. */
  subscribe: (fn: () => void) => () => void;
}

type HistState = Record<string, unknown> & { idx?: number };

/** How many overlay entries of ours are stacked on the current entry (0 = a plain entry). */
export function overlayDepth(state: unknown): number {
  const v = (state as Record<string, unknown> | null)?.[MARK];
  return typeof v === 'number' ? v : 0;
}

export function startWebBack({ win = window, subscribe }: WebBackDeps): () => void {
  const doc = win.document;
  const state = () => (win.history.state ?? null) as HistState | null;
  const count = () => doc.querySelectorAll(SELECTOR).length;
  let open = count();
  /** Our own history.go() calls, whose popstate is not a Back press. */
  let ownPops = 0;
  /** Router index and our depth of the entry we are on (react-router keeps idx in the state). */
  let lastIdx = state()?.idx ?? 0;
  let lastDepth = overlayDepth(state());

  const goBack = (n: number) => {
    ownPops++;
    win.history.go(-n);
  };

  const sync = () => {
    const now = count();
    for (let i = open; i < now; i++) {
      const s = state() ?? {};
      lastDepth = overlayDepth(s) + 1;
      win.history.pushState({ ...s, [MARK]: lastDepth }, '', win.location.href);
    }
    open = now;
  };

  const onPop = () => {
    const s = state();
    const idx = s?.idx ?? 0;
    const depth = overlayDepth(s);
    const fromIdx = lastIdx;
    const fromDepth = lastDepth;
    lastIdx = idx;
    lastDepth = depth;
    if (ownPops > 0) {
      ownPops--;
      return;
    }
    if (count() > 0) {
      // Back with a dialog or sheet open: this pop took its entry off; close the top one.
      closeTopOverlay(doc);
      open = Math.max(0, count() - 1);
      return;
    }
    if (idx === fromIdx && depth < fromDepth) {
      // Back on the same page with nothing open: it only took off an entry left by an overlay
      // that was closed another way. Go on through the rest and leave the page, as asked.
      goBack(depth + 1);
    } else if (idx < fromIdx && depth > 0) {
      // Back from a page opened inside an overlay: land on the page itself, not its leftovers.
      goBack(depth);
    }
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
      lastDepth = overlayDepth(state());
    }, 0);
  });
  win.addEventListener('popstate', onPop, true);
  return () => {
    observer.disconnect();
    unsubscribe();
    win.removeEventListener('popstate', onPop, true);
  };
}
