// Nonce for native Google sign-in. Google puts the value it is given into the ID token's `nonce`
// claim; Supabase (signInWithIdToken) receives the raw value, hashes it with SHA-256 and compares.
// So Google gets the hex SHA-256 and Supabase the raw nonce, which never leaves the device before
// the token exists (replay protection).

function hex(bytes: ArrayBuffer | Uint8Array): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(s: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}

export async function makeNonce(): Promise<{ raw: string; hashed: string }> {
  const raw = hex(crypto.getRandomValues(new Uint8Array(32)));
  return { raw, hashed: await sha256Hex(raw) };
}
