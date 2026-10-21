// Linking this device's data to the signed-in account (plan, "Hesap"):
//   - same account as before → just sync
//   - nothing local, or nothing on the server → take over the local data and push
//   - both have data (second device) → ask: merge (default) / discard local / discard account
import { useSyncExternalStore } from 'react';
import {
  claimLocalData,
  countPossibleDuplicates,
  discardAccountData,
  discardLocalData,
  dropLocalSettings,
  getLinkedUserId,
  hasLocalUserData,
  logError,
  type RemoteSnapshot,
} from '@/data';
import { signOut as supabaseSignOut } from '@/lib/supabase';
import { MAX_PULL_PAGE } from '@/sync/api';
import type { SyncEngine, SyncTransport } from '@/sync/engine';

export type LinkChoice = 'merge' | 'discard_local' | 'discard_account';

export type LinkState =
  | { phase: 'idle' }
  | { phase: 'checking'; userId: string }
  | { phase: 'choose'; userId: string; otherAccount: boolean }
  | { phase: 'applying'; userId: string; choice: LinkChoice; otherAccount: boolean }
  | { phase: 'error'; userId: string; message: string }
  | { phase: 'done'; userId: string; duplicates: number };

let state: LinkState = { phase: 'idle' };
const listeners = new Set<() => void>();
function set(next: LinkState) {
  state = next;
  for (const l of listeners) l();
}
export const getLinkState = () => state;
export function subscribeLink(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function useLinkState(): LinkState {
  return useSyncExternalStore(subscribeLink, getLinkState, getLinkState);
}

export interface LinkDeps {
  transport: SyncTransport;
  engine: Pick<SyncEngine, 'sync' | 'isActive'>;
}

let deps: LinkDeps | null = null;
export function configureLink(d: LinkDeps): void {
  deps = d;
}
function need(): LinkDeps {
  if (!deps) throw new Error('configureLink() was not called');
  return deps;
}

async function serverHasData(t: SyncTransport): Promise<boolean> {
  const page = await t.pullChanges(0, 1);
  return page.rows.length > 0 || page.invalid.length > 0;
}

async function finish(userId: string): Promise<void> {
  const { engine } = need();
  await engine.isActive();
  await engine.sync({ force: true });
  set({ phase: 'done', userId, duplicates: await countPossibleDuplicates() });
}

/** Run after every sign-in (and on start with a restored session). */
export async function linkAccount(userId: string): Promise<void> {
  const { transport, engine } = need();
  const linked = await getLinkedUserId();
  if (linked === userId) {
    set({ phase: 'idle' });
    await engine.isActive();
    await engine.sync();
    return;
  }
  set({ phase: 'checking', userId });
  try {
    const [local, remote] = await Promise.all([hasLocalUserData(), serverHasData(transport)]);
    if (local && remote) {
      set({ phase: 'choose', userId, otherAccount: linked !== null });
      return;
    }
    if (remote) await dropLocalSettings(); // nothing local worth keeping: take the account's settings
    await claimLocalData(userId);
    await finish(userId);
  } catch (e) {
    void logError(e, 'auth.link');
    set({ phase: 'error', userId, message: e instanceof Error ? e.message : String(e) });
  }
}

/** Pull every row of the account (for "hesaptakini at"). */
async function snapshotAccount(t: SyncTransport): Promise<RemoteSnapshot> {
  const rows: RemoteSnapshot['rows'] = [];
  let cursor = 0;
  for (;;) {
    const page = await t.pullChanges(cursor, MAX_PULL_PAGE);
    for (const r of page.rows) rows.push({ table: r.table, row: r.row });
    cursor = page.next_seq;
    if (!page.has_more) break;
  }
  return { rows, nextSeq: cursor };
}

/** The user's answer in the dialog. */
export async function resolveLink(choice: LinkChoice): Promise<void> {
  const s = state;
  if (s.phase !== 'choose' && s.phase !== 'error') return;
  const { userId } = s;
  const { transport } = need();
  set({ phase: 'applying', userId, choice, otherAccount: s.phase === 'choose' && s.otherAccount });
  try {
    if (choice === 'merge') {
      await dropLocalSettings(); // the account's settings win; notes and history are merged
      await claimLocalData(userId);
    } else if (choice === 'discard_local') {
      await discardLocalData(userId);
    } else {
      await discardAccountData(userId, await snapshotAccount(transport));
    }
    await finish(userId);
  } catch (e) {
    void logError(e, 'auth.resolveLink');
    set({ phase: 'error', userId, message: e instanceof Error ? e.message : String(e) });
  }
}

/** Retry after an error (e.g. offline during the check). */
export function retryLink(): void {
  const s = state;
  if (s.phase === 'error') void linkAccount(s.userId);
}

/**
 * Give up on linking for now: sign out and keep using the app as a guest. Nothing local is
 * touched; the next sign-in runs the linking flow again.
 */
export async function continueAsGuest(): Promise<void> {
  set({ phase: 'idle' });
  try {
    await supabaseSignOut();
  } catch (e) {
    void logError(e, 'auth.continueAsGuest');
  }
}

export function dismissLinkResult(): void {
  if (state.phase === 'done') set({ phase: 'idle' });
}

/** Tests only. */
export function resetLinkForTesting(): void {
  set({ phase: 'idle' });
}
