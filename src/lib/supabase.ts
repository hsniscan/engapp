// Supabase client. When VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY are missing the
// app runs in guest mode: `supabase` is null and every helper below degrades gracefully.
// The key is the public publishable key (sb_publishable_...); security is RLS, not the key.
//
// supabase-js (~54 KB gzip) is loaded on first use, not at start-up (v0.5.1, decision 0059): a
// guest who never signs in never downloads it. A device with a stored session (or coming back
// from Google with ?code=) loads it at once, so a signed-in start is unchanged.

import type { Session, SupabaseClient } from '@supabase/supabase-js';

export interface BackendConfig {
  url: string;
  key: string;
}

export function readBackendConfig(
  env: Partial<ImportMetaEnv> = import.meta.env,
): BackendConfig | null {
  const url = env.VITE_SUPABASE_URL?.trim().replace(/\/$/, '');
  const key = (env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY)?.trim();
  return url && key ? { url, key } : null;
}

export const backendConfig: BackendConfig | null = readBackendConfig();

let client: SupabaseClient | null = null;
let loading: Promise<SupabaseClient | null> | null = null;
/** onAuthChange callbacks waiting for the client (a guest's, until the client loads). */
const authCallbacks = new Set<(session: Session | null) => void>();

/** The client, loading supabase-js on the first call; null in guest-only builds. */
export function loadSupabase(): Promise<SupabaseClient | null> {
  if (!backendConfig) return Promise.resolve(null);
  if (client) return Promise.resolve(client);
  loading ??= import('@supabase/supabase-js').then(({ createClient }) => {
    client = createClient(backendConfig.url, backendConfig.key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
    });
    for (const cb of authCallbacks) subscribe(client, cb);
    return client;
  });
  return loading;
}

/**
 * Whether this device may have a session: supabase-js keeps it under `sb-<ref>-auth-token`,
 * and the OAuth return carries `?code=` (PKCE). Without either the user is a guest and the
 * client need not load.
 */
export function mayHaveSession(
  storage: Pick<Storage, 'length' | 'key'> | null = safeLocalStorage(),
  search: string = typeof location === 'undefined' ? '' : location.search,
): boolean {
  if (/[?&]code=/.test(search)) return true;
  if (!storage) return true;
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k && /^sb-.*-auth-token(-code-verifier)?$/.test(k)) return true;
  }
  return false;
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The client when a session may exist, else null without loading supabase-js. */
async function sessionClient(): Promise<SupabaseClient | null> {
  if (!backendConfig) return null;
  if (!client && !mayHaveSession()) return null;
  return loadSupabase();
}

export function isBackendConfigured(): boolean {
  return backendConfig !== null;
}

export class BackendNotConfiguredError extends Error {
  constructor() {
    super('Supabase is not configured (guest mode)');
    this.name = 'BackendNotConfiguredError';
  }
}

export async function requireSupabase(): Promise<SupabaseClient> {
  const c = await loadSupabase();
  if (!c) throw new BackendNotConfiguredError();
  return c;
}

export async function getSession(): Promise<Session | null> {
  const c = await sessionClient();
  if (!c) return null;
  const { data } = await c.auth.getSession();
  return data.session;
}

/** Current access token (refreshed by supabase-js when needed), or null for guests. */
export async function getAccessToken(): Promise<string | null> {
  return (await getSession())?.access_token ?? null;
}

export async function getUserId(): Promise<string | null> {
  return (await getSession())?.user.id ?? null;
}

/**
 * Google is the only sign-in method. Redirects the page to Google; Supabase sends the
 * user back to `redirectTo`, which must be listed under Auth > URL Configuration.
 */
export async function signInWithGoogle(redirectTo: string = window.location.origin): Promise<void> {
  const { error } = await (
    await requireSupabase()
  ).auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo },
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  const c = await sessionClient();
  if (!c) return;
  const { error } = await c.auth.signOut();
  if (error) throw error;
}

/**
 * Ends the session on this device only (no call to the server). Used after account deletion,
 * when the account no longer exists and a global sign-out would be refused.
 */
export async function signOutLocal(): Promise<void> {
  const c = await sessionClient();
  if (!c) return;
  const { error } = await c.auth.signOut({ scope: 'local' });
  if (error) throw error;
}

const unsubscribers = new Map<(session: Session | null) => void, () => void>();

function subscribe(c: SupabaseClient, cb: (session: Session | null) => void): void {
  const { data } = c.auth.onAuthStateChange((_event, session) => cb(session));
  unsubscribers.set(cb, () => data.subscription.unsubscribe());
}

/**
 * Subscribes to sign-in/sign-out. Returns an unsubscribe function (no-op in guest mode). On a
 * device without a session the callback hears "no session" at once and the client loads only
 * when something needs it (sign-in); the callback is attached to it then.
 */
export function onAuthChange(cb: (session: Session | null) => void): () => void {
  if (!backendConfig) return () => {};
  authCallbacks.add(cb);
  if (client) subscribe(client, cb);
  else if (mayHaveSession()) void loadSupabase();
  else queueMicrotask(() => cb(null));
  return () => {
    authCallbacks.delete(cb);
    unsubscribers.get(cb)?.();
    unsubscribers.delete(cb);
  };
}
