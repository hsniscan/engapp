// Account deletion and device wipe (v0.4 İP7, docs/decisions/0035-account-deletion.md).
//
//   deleteAccount()   the account-delete edge function removes everything on the server and
//                     the account itself; then this device is wiped (when its data belongs to
//                     that account) and signed out.
//   wipeThisDevice()  guest mode / "Bu cihazdaki verileri sil": only the local copy.
//
// The device is wiped only after the server confirmed: if the call fails, nothing local is
// lost and the user can try again (the function is idempotent).
import {
  ACCOUNT_DELETE_CONFIRM,
  accountDeleteResponse,
  type AccountDeleteResponse,
} from '../../../supabase/functions/_shared/account-delete-contract';
import { getCurrentUserId, logError, wipeLocalDatabase } from '@/data';
import { disablePush } from '@/features/notify/push';
import { backendConfig, getAccessToken, getUserId, signOutLocal } from '@/lib/supabase';

/** Cache Storage of pronunciation audio: may hold audio of the user's own sentences. */
const AUDIO_CACHE = 'engapp-tts';
/** localStorage keys of the app (theme, flags, push owner, …); supabase-js keys go with sign-out. */
const LOCAL_PREFIX = 'engapp.';

export type DeletionErrorCode = 'not_configured' | 'not_signed_in' | 'offline' | 'server';

export class DeletionError extends Error {
  readonly code: DeletionErrorCode;
  constructor(code: DeletionErrorCode, message: string) {
    super(message);
    this.name = 'DeletionError';
    this.code = code;
  }
}

export interface DeletionDeps {
  fetch?: typeof fetch;
  config?: { url: string; key: string } | null;
  getAccessToken?: () => Promise<string | null>;
  getUserId?: () => Promise<string | null>;
  /** Device side; the defaults act on this browser. */
  wipeDevice?: () => Promise<void>;
  signOut?: () => Promise<void>;
}

/** POST /functions/v1/account-delete with the session token. */
export async function requestAccountDeletion(deps: DeletionDeps = {}): Promise<AccountDeleteResponse> {
  const config = deps.config === undefined ? backendConfig : deps.config;
  if (!config) throw new DeletionError('not_configured', 'Supabase is not configured');
  const token = await (deps.getAccessToken ?? getAccessToken)();
  if (!token) throw new DeletionError('not_signed_in', 'No session');
  let res: Response;
  try {
    res = await (deps.fetch ?? fetch)(`${config.url}/functions/v1/account-delete`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        apikey: config.key,
      },
      body: JSON.stringify({ confirm: ACCOUNT_DELETE_CONFIRM }),
    });
  } catch (e) {
    throw new DeletionError('offline', e instanceof Error ? e.message : String(e));
  }
  if (res.status === 401) throw new DeletionError('not_signed_in', 'Session expired');
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // handled below
  }
  const parsed = accountDeleteResponse.safeParse(body);
  if (!res.ok || !parsed.success) throw new DeletionError('server', `HTTP ${res.status}`);
  return parsed.data;
}

/** Empties the local database, the audio cache, the app's localStorage keys and push. */
export async function wipeDeviceData(): Promise<void> {
  // The browser's push subscription (the server rows are gone with the account, or never
  // existed for a guest).
  await disablePush(undefined, { server: false }).catch(() => undefined);
  await wipeLocalDatabase();
  try {
    if (typeof caches !== 'undefined') await caches.delete(AUDIO_CACHE);
  } catch {
    // Cache Storage blocked: nothing stored there either
  }
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(LOCAL_PREFIX)) keys.push(k);
    }
    for (const k of keys) localStorage.removeItem(k);
  } catch {
    // storage blocked
  }
}

export interface DeleteAccountResult {
  server: AccountDeleteResponse;
  /** Whether this device's local data was wiped (it belonged to the deleted account). */
  wiped: boolean;
}

/**
 * Deletes the signed-in account on the server, then wipes this device and signs out.
 * `wipe: 'always'` (in-app) wipes the device in any case; `'if-linked'` (the web page) only
 * when the device's data belongs to the deleted account, so a guest's or another account's
 * local data in that browser is left alone.
 */
export async function deleteAccount(
  opts: { wipe: 'always' | 'if-linked' },
  deps: DeletionDeps = {},
): Promise<DeleteAccountResult> {
  const userId = await (deps.getUserId ?? getUserId)();
  const server = await requestAccountDeletion(deps);
  const linked = await getCurrentUserId().catch(() => null);
  const wipe = opts.wipe === 'always' || (userId !== null && linked === userId);
  if (wipe) {
    try {
      await (deps.wipeDevice ?? wipeDeviceData)();
    } catch (e) {
      // The account is gone already; a failed local wipe must not keep the user signed in.
      void logError(e, 'account.delete.wipe');
    }
  }
  try {
    await (deps.signOut ?? signOutLocal)();
  } catch (e) {
    void logError(e, 'account.delete.signOut');
  }
  return { server, wiped: wipe };
}

/** Guest mode / signed out: only this device's data. */
export async function wipeThisDevice(deps: Pick<DeletionDeps, 'wipeDevice'> = {}): Promise<void> {
  await (deps.wipeDevice ?? wipeDeviceData)();
}

/** Where the app goes after a deletion: a full reload, so every in-memory state starts fresh. */
export function reloadTo(path: string): void {
  window.location.assign(path);
}
