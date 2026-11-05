// One ready-deck add at a time, with its progress for every screen that shows it (v0.5.3 A1,
// ADR 0072). The add itself is data/deckHub.addSuggestedDeck (chunked, with a job row); this
// keeps the run single-flight, so onboarding, a deck page and the start-up resume never add
// the same deck twice at once, and a screen that mounts mid-add shows "Ekleniyor… n/N".
import { useSyncExternalStore } from 'react';
import { logError } from '@/data';
import {
  addSuggestedDeck,
  pendingDeckAdd,
  resumeDeckAdd,
  type SuggestedAddResult,
} from '@/data/deckHub';
import type { WordBankEntry } from '@/domain/wordBank';

export interface DeckAddProgress {
  name: string;
  done: number;
  total: number;
}

let current: DeckAddProgress | null = null;
let running: Promise<SuggestedAddResult | null> | null = null;
const listeners = new Set<() => void>();

function set(p: DeckAddProgress | null) {
  current = p;
  for (const l of [...listeners]) l();
}

function run(
  name: string,
  work: (onProgress: (done: number, total: number) => void) => Promise<SuggestedAddResult | null>,
): Promise<SuggestedAddResult | null> {
  if (running) return running;
  set({ name, done: 0, total: 0 });
  running = work((done, total) => set({ name, done, total })).finally(() => {
    running = null;
    set(null);
  });
  return running;
}

/**
 * Adds a ready deck. The same deck already going in is joined, not started twice; another
 * deck waits for it.
 */
export function runDeckAdd(
  words: readonly WordBankEntry[],
  name: string,
): Promise<SuggestedAddResult | null> {
  if (running && current?.name !== name)
    return running.catch(() => null).then(() => runDeckAdd(words, name));
  return run(name, (onProgress) => addSuggestedDeck(words, name, { onProgress }));
}

/** Finishes an add that was cut short (app closed mid-add). Null: nothing to finish. */
export async function resumePendingDeckAdd(): Promise<SuggestedAddResult | null> {
  if (running) return running;
  const job = await pendingDeckAdd().catch((e: unknown) => {
    void logError(e, 'deckAdd.pending');
    return null;
  });
  if (!job) return null;
  return run(job.name, (onProgress) => resumeDeckAdd({ onProgress }));
}

export function deckAddProgress(): DeckAddProgress | null {
  return current;
}

export function useDeckAddProgress(): DeckAddProgress | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    deckAddProgress,
    deckAddProgress,
  );
}
