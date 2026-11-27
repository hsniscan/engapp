// The 30-day forecast for screens: inputs come from a live query, the computation runs in an
// idle callback so it never delays a render or a card switch (docs/decisions/0021).
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import {
  computeRetentionWorkloads,
  computeWorkload,
  getWorkloadInput,
  type RetentionWorkload,
  type WorkloadInput,
  type WorkloadView,
} from '@/data';

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

export interface RetentionWorkloads {
  choices: RetentionWorkload[];
  /** Studied cards in the forecast (0: nothing to estimate yet). */
  studied: number;
  /** New words waiting for the daily budget, and the budget itself. */
  newAvailable: number;
  dailyNewLimit: number;
}

/**
 * Ayarlar › Çalışma's retention helper: İlerleme's 30-day forecast run at each target.
 * `inputs` is the live workload input (the caller picks the live query); undefined while
 * loading or computing.
 */
export function useRetentionWorkloads(
  input: WorkloadInput | undefined,
  retentions: readonly number[],
): RetentionWorkloads | undefined {
  const [view, setView] = useState<RetentionWorkloads | undefined>(undefined);
  const key = retentions.join(',');
  useEffect(() => {
    if (!input) return;
    const h = whenIdle(() =>
      setView({
        choices: computeRetentionWorkloads(input, key.split(',').map(Number)),
        studied: input.cards.length,
        newAvailable: input.newAvailable,
        dailyNewLimit: input.dailyNewLimit,
      }),
    );
    return () => h.cancel();
  }, [input, key]);
  return view;
}
