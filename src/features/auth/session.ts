// Auth session store (Google sign-in only, docs/decisions/0002). supabase-js keeps the
// session in localStorage and refreshes it; this store mirrors it for React and drives the
// account-linking flow on sign-in.
import type { Session } from '@supabase/supabase-js';
import { useSyncExternalStore } from 'react';
import { logError } from '@/data';
import {
  isBackendConfigured,
  onAuthChange,
  signInWithGoogle,
  signOut as supabaseSignOut,
} from '@/lib/supabase';

export interface AuthUser {
  id: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
}

export type AuthStatus = 'unavailable' | 'loading' | 'guest' | 'signed_in';

export interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
}

let state: AuthState = { status: isBackendConfigured() ? 'loading' : 'unavailable', user: null };
const listeners = new Set<() => void>();
const userListeners = new Set<(user: AuthUser | null) => void>();

let notified: string | null | undefined; // user id last announced to userListeners

function set(next: AuthState) {
  state = next;
  for (const l of listeners) l();
  if (next.status === 'loading') return;
  const id = next.user?.id ?? null;
  if (id === notified) return; // token refreshes do not re-run the linking flow
  notified = id;
  for (const l of userListeners) l(next.user);
}

export function toAuthUser(session: Session | null): AuthUser | null {
  if (!session) return null;
  const u = session.user;
  const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return {
    id: u.id,
    email: u.email ?? str(meta.email),
    name: str(meta.full_name) ?? str(meta.name),
    avatarUrl: str(meta.avatar_url) ?? str(meta.picture),
  };
}

/** For tests and the dev gallery: set the state directly. */
export function setAuthStateForTesting(next: AuthState): void {
  set(next);
}

export function getAuthState(): AuthState {
  return state;
}

export function subscribeAuth(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Called with the user after every sign-in/sign-out (and once with the restored session). */
export function onUserChange(l: (user: AuthUser | null) => void): () => void {
  userListeners.add(l);
  return () => userListeners.delete(l);
}

let started = false;

/** Subscribes to supabase auth (idempotent). The OAuth return (?code=…) is handled by supabase-js. */
export function startAuth(): void {
  if (started || !isBackendConfigured()) return;
  started = true;
  onAuthChange((session) => {
    const user = toAuthUser(session);
    set({ status: user ? 'signed_in' : 'guest', user });
  });
}

export interface UseAuth extends AuthState {
  /** False when the app was built without the Supabase env (guest only). */
  available: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

/** Redirect back to /auth, which finishes the sign-in and links the device's data. */
export function authRedirectUrl(): string {
  return `${window.location.origin}/auth`;
}

async function signIn(): Promise<void> {
  await signInWithGoogle(authRedirectUrl());
}

async function signOut(): Promise<void> {
  try {
    await supabaseSignOut();
  } catch (e) {
    void logError(e, 'auth.signOut');
    throw e;
  }
}

export function useAuth(): UseAuth {
  const s = useSyncExternalStore(subscribeAuth, getAuthState, getAuthState);
  return { ...s, available: s.status !== 'unavailable', signIn, signOut };
}
