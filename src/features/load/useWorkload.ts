// The 30-day forecast for screens: inputs come from a live query, the computation runs in an
// idle callback so it never delays a render or a card switch (docs/decisions/0021).
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { computeWorkload, getWorkloadInput, type WorkloadView } from '@/data';

type IdleHandle = { cancel: () => void };

function whenIdle(fn: () => void): IdleHandle {
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    const id = window.requestIdleCallback(fn, { timeout: 1000 });
    return { cancel: () => window.cancelIdleCallback(id) };
  }
  const id = setTimeout(fn, 0);
  return { cancel: () => clearTimeout(id) };
}

/** undefined while loading or computing. */
export function useWorkload(): WorkloadView | undefined {
  const input = useLiveQuery(() => getWorkloadInput(), []);
  const [view, setView] = useState<WorkloadView | undefined>(undefined);
  useEffect(() => {
    if (!input) return;
    const h = whenIdle(() => setView(computeWorkload(input)));
    return () => h.cancel();
  }, [input]);
  return view;
}
