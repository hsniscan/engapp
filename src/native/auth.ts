// Native Google sign-in in the Android app (docs/decisions/0033-android-capacitor.md, 0002).
// Google blocks its OAuth pages inside WebViews, so the web redirect flow cannot be used here.
// Android's Credential Manager shows the account sheet and returns a Google ID token; Supabase
// verifies it and starts the session (signInWithIdToken). The token's audience is the existing
// *web* OAuth client (VITE_GOOGLE_WEB_CLIENT_ID, already accepted by Supabase's Google provider);
// Google only issues it to this package if an Android OAuth client with the package name and the
// signing key's SHA-1 exists in the same Google Cloud project (docs/setup-android.md).
import { ErrorCode, GoogleSignIn } from '@capawesome/capacitor-google-sign-in';
import i18n from '@/i18n';
import { requireSupabase } from '@/lib/supabase';
import { toast } from '@/ui';
import { makeNonce } from './nonce';

export type NativeSignInFailure = 'not_configured' | 'no_account' | 'play_services';

/** The web OAuth client id from the build environment; null when missing. */
export function googleWebClientId(env: Partial<ImportMetaEnv> = import.meta.env): string | null {
  const id = env.VITE_GOOGLE_WEB_CLIENT_ID?.trim();
  return id ? id : null;
}

/** Maps the plugin's error codes; 'canceled' = the user closed the sheet (not an error). */
export function classifySignInError(e: unknown): NativeSignInFailure | 'canceled' | 'failed' {
  const code = (e as { code?: unknown } | null)?.code;
  if (code === ErrorCode.SignInCanceled) return 'canceled';
  if (code === ErrorCode.NoCredentialAvailable) return 'no_account';
  if (code === ErrorCode.ProviderConfigurationError) return 'play_services';
  return 'failed';
}

let initialized: Promise<void> | null = null;

/**
 * Shows the Google account sheet and signs in to Supabase. Resolves without a session when the
 * user closes the sheet; for known setup problems it shows its own message and resolves; other
 * failures throw (the caller shows "Google ile giriş başlatılamadı").
 */
export async function signInNative(): Promise<void> {
  const clientId = googleWebClientId();
  if (!clientId) {
    toast({ title: i18n.t('native.signIn.not_configured'), tone: 'danger' });
    return;
  }
  initialized ??= GoogleSignIn.initialize({ clientId }).catch((e: unknown) => {
    initialized = null;
    throw e;
  });
  await initialized;
  const nonce = await makeNonce();
  let idToken: string;
  try {
    idToken = (await GoogleSignIn.signIn({ nonce: nonce.hashed })).idToken;
  } catch (e) {
    const kind = classifySignInError(e);
    if (kind === 'canceled') return;
    if (kind === 'failed') throw e;
    toast({ title: i18n.t(`native.signIn.${kind}`), tone: 'danger', duration: 10_000 });
    return;
  }
  const { error } = await (await requireSupabase()).auth.signInWithIdToken({
    provider: 'google',
    token: idToken,
    nonce: nonce.raw,
  });
  if (error) throw error;
}

/** Forgets the chosen account, so the next sign-in shows the account sheet again. */
export async function signOutNative(): Promise<void> {
  try {
    await GoogleSignIn.signOut();
  } catch {
    // nothing to clear
  }
}
