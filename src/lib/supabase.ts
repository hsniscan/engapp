// Supabase client. When VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY are missing the
// app runs in guest mode: `supabase` is null and every helper below degrades gracefully.
// The key is the public publishable key (sb_publishable_...); security is RLS, not the key.

import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';

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

export const supabase: SupabaseClient | null = backendConfig
  ? createClient(backendConfig.url, backendConfig.key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
    })
  : null;

export function isBackendConfigured(): boolean {
  return supabase !== null;
}

export class BackendNotConfiguredError extends Error {
  constructor() {
    super('Supabase is not configured (guest mode)');
    this.name = 'BackendNotConfiguredError';
  }
}

export function requireSupabase(): SupabaseClient {
  if (!supabase) throw new BackendNotConfiguredError();
  return supabase;
}

export async function getSession(): Promise<Session | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
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
  const { error } = await requireSupabase().auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo },
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/** Subscribes to sign-in/sign-out. Returns an unsubscribe function (no-op in guest mode). */
export function onAuthChange(cb: (session: Session | null) => void): () => void {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => cb(session));
  return () => data.subscription.unsubscribe();
}
