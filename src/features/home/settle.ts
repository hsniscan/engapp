// Bugün's secondary reads wait until the page has settled (v0.5.1, decision 0059).
import { useEffect, useState } from 'react';

/** How long Bugün waits after the hero before its secondary reads (decision 0059). */
let settleMs = 1200;

/** Unit tests render Bugün without the wait (src/test/setup.ts). */
export function setHomeSettleMsForTesting(ms: number): void {
  settleMs = ms;
}

/**
 * True once `ready` has been true and the page then stayed idle for `delayMs` (or the browser
 * reported idle). Stays true. Bugün's secondary reads wait for it.
 */
export function useSettled(ready: boolean, delayMs = settleMs): boolean {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!ready || settled || delayMs <= 0) return;
    let idleId: number | undefined;
    const timer = setTimeout(() => {
      if (typeof requestIdleCallback === 'function')
        idleId = requestIdleCallback(() => setSettled(true), { timeout: 1000 });
      else setSettled(true);
    }, delayMs);
    return () => {
      clearTimeout(timer);
      if (idleId !== undefined) cancelIdleCallback(idleId);
    };
  }, [ready, settled, delayMs]);
  return settled || (ready && delayMs <= 0);
}
