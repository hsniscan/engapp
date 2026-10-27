import { describe, expect, it } from 'vitest';
import { mayHaveSession, readBackendConfig } from './supabase';

function storage(keys: string[]): Pick<Storage, 'length' | 'key'> {
  return { length: keys.length, key: (i: number) => keys[i] ?? null };
}

describe('lazy supabase client (decision 0059)', () => {
  it('a guest device (no stored session, no OAuth code) does not need the client', () => {
    expect(mayHaveSession(storage(['engapp.theme', 'i18nextLng']), '')).toBe(false);
    expect(mayHaveSession(storage([]), '?tab=reading')).toBe(false);
  });

  it('a stored session or the Google return loads it', () => {
    expect(mayHaveSession(storage(['sb-abc-auth-token']), '')).toBe(true);
    expect(mayHaveSession(storage(['sb-abc-auth-token-code-verifier']), '')).toBe(true);
    expect(mayHaveSession(storage([]), '?code=xyz')).toBe(true);
    expect(mayHaveSession(storage([]), '?a=1&code=xyz')).toBe(true);
  });

  it('without storage it assumes a session (never logs a user out by mistake)', () => {
    expect(mayHaveSession(null, '')).toBe(true);
  });

  it('reads the backend config', () => {
    expect(readBackendConfig({})).toBeNull();
    expect(
      readBackendConfig({
        VITE_SUPABASE_URL: 'https://x.supabase.co/',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'k',
      }),
    ).toEqual({ url: 'https://x.supabase.co', key: 'k' });
  });
});
