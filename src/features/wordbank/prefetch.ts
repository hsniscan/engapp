// The offline word bank in the background (v0.5.3 A2, ADR 0072). Guests used to get it only
// when Kelime Bankası or Keşfet opened, so the reader and the add sheet told them to sign in
// for words the app ships. Now the first start fetches it once the app is idle: online only,
// never on a connection that asks to save data (or a slow / mobile one), and it resumes where a
// cut-short run stopped (the fetch goes page by page after the device's cursor). A lookup that
// misses still fetches on demand whatever the connection: the user asked for that word.
import { useSyncExternalStore } from 'react';
import { logError } from '@/data';
import {
  fetchWordBank,
  isWordBankComplete,
  onWordBankChange,
  wordBankEpoch,
  type WordBankFetchOutcome,
} from './fetcher';

/** What the Network Information API tells (Chromium and the Android WebView; absent elsewhere). */
export interface ConnectionInfo {
  saveData?: boolean;
  effectiveType?: string;
  type?: string;
}

export interface PrefetchEnv {
  online: boolean;
  connection: ConnectionInfo | null;
}

/** Background download allowed: online, and not a metered, data-saving or slow connection. */
export function mayPrefetch(env: PrefetchEnv): boolean {
  if (!env.online) return false;
  const c = env.connection;
  if (!c) return true;
  if (c.saveData) return false;
  if (c.type === 'cellular') return false;
  return c.effectiveType !== 'slow-2g' && c.effectiveType !== '2g';
}

export function browserPrefetchEnv(): PrefetchEnv {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  const connection = (nav as (Navigator & { connection?: ConnectionInfo }) | undefined)?.connection;
  return { online: nav ? nav.onLine !== false : true, connection: connection ?? null };
}

export interface PrefetchDeps {
  env: () => PrefetchEnv;
  complete: () => Promise<boolean>;
  fetch: () => Promise<WordBankFetchOutcome>;
  /** Calls `retry` when the device comes back online; returns a stop function. */
  onOnline: (retry: () => void) => () => void;
}

const defaultDeps: PrefetchDeps = {
  env: browserPrefetchEnv,
  complete: isWordBankComplete,
  fetch: () => fetchWordBank(),
  onOnline: (retry) => {
    if (typeof window === 'undefined') return () => {};
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  },
};

/**
 * One background attempt, and another each time the device comes back online, until the bank
 * is complete. A complete bank still refreshes through fetchWordBank's own 15-minute rule.
 * Returns a stop function.
 */
export function startWordBankPrefetch(deps: PrefetchDeps = defaultDeps): () => void {
  let stopped = false;
  let busy = false;
  const attempt = async () => {
    if (stopped || busy) return;
    busy = true;
    try {
      if (!mayPrefetch(deps.env())) return;
      const r = await deps.fetch();
      if (r.status === 'done' || r.status === 'fresh' || r.status === 'no_backend') {
        if (r.status === 'no_backend' || (await deps.complete())) stop();
      }
    } catch (e) {
      void logError(e, 'wordBank.prefetch');
    } finally {
      busy = false;
    }
  };
  const offOnline = deps.onOnline(() => void attempt());
  const stop = () => {
    stopped = true;
    offOnline();
  };
  void attempt();
  return stop;
}

/** Changes whenever new bank rows land: put it in a lookup's deps to run it again. */
export function useWordBankEpoch(): number {
  return useSyncExternalStore(onWordBankChange, wordBankEpoch, wordBankEpoch);
}
