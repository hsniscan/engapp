// One sync runner per browser profile (plan: "Senkronu yalnızca bir sekme çalıştırır").
// Web Locks API when available; otherwise a small BroadcastChannel leader election;
// otherwise (very old browsers, tests) the tab simply runs.

export interface TabRunner {
  /** Runs fn if this tab may run now; returns undefined when another tab holds the lock. */
  run<T>(fn: () => Promise<T>): Promise<T | undefined>;
  /** For the BroadcastChannel fallback: forward a request to the leader tab. */
  dispose(): void;
}

export function createTabRunner(name: string, onRemoteRequest?: () => void): TabRunner {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (locks && typeof locks.request === 'function') {
    return {
      async run<T>(fn: () => Promise<T>) {
        let out: T | undefined;
        await locks.request(name, { ifAvailable: true }, async (lock) => {
          if (lock) out = await fn();
        });
        return out;
      },
      dispose() {},
    };
  }
  if (typeof BroadcastChannel !== 'undefined') return leaderRunner(name, onRemoteRequest);
  let busy = false;
  return {
    async run<T>(fn: () => Promise<T>) {
      if (busy) return undefined;
      busy = true;
      try {
        return await fn();
      } finally {
        busy = false;
      }
    },
    dispose() {},
  };
}

type Msg = { t: 'claim'; id: string; at: number } | { t: 'leader'; id: string } | { t: 'resign'; id: string } | { t: 'request' };

/**
 * Fallback leader election: the oldest tab that claimed leadership wins. Followers do not
 * run; they forward requests to the leader. When the leader closes, the others re-claim.
 */
function leaderRunner(name: string, onRemoteRequest?: () => void): TabRunner {
  const id = Math.random().toString(36).slice(2);
  const born = Date.now();
  const ch = new BroadcastChannel(`lock:${name}`);
  let leader: string | null = id; // optimistic until an older tab answers
  let busy = false;
  const claim = () => ch.postMessage({ t: 'claim', id, at: born } satisfies Msg);
  ch.onmessage = (e: MessageEvent<Msg>) => {
    const m = e.data;
    if (m.t === 'claim') {
      if (leader === id && (m.at > born || (m.at === born && m.id > id))) ch.postMessage({ t: 'leader', id } satisfies Msg);
      else if (m.at < born || (m.at === born && m.id < id)) leader = m.id;
    } else if (m.t === 'leader') {
      if (m.id !== id) leader = m.id;
    } else if (m.t === 'resign') {
      if (leader === m.id) {
        leader = id;
        claim();
      }
    } else if (m.t === 'request') {
      if (leader === id) onRemoteRequest?.();
    }
  };
  claim();
  const resign = () => ch.postMessage({ t: 'resign', id } satisfies Msg);
  if (typeof window !== 'undefined') window.addEventListener('pagehide', resign);
  return {
    async run<T>(fn: () => Promise<T>) {
      if (leader !== id) {
        ch.postMessage({ t: 'request' } satisfies Msg);
        return undefined;
      }
      if (busy) return undefined;
      busy = true;
      try {
        return await fn();
      } finally {
        busy = false;
      }
    },
    dispose() {
      resign();
      if (typeof window !== 'undefined') window.removeEventListener('pagehide', resign);
      ch.close();
    },
  };
}
