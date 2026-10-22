import { describe, expect, it } from 'vitest';
import { makeNonce, sha256Hex } from './nonce';

describe('sign-in nonce', () => {
  it('gives Google the SHA-256 of the raw nonce Supabase receives', async () => {
    const { raw, hashed } = await makeNonce();
    expect(raw).toMatch(/^[0-9a-f]{64}$/);
    expect(hashed).toBe(await sha256Hex(raw));
    expect(hashed).not.toBe(raw);
  });

  it('is fresh every time', async () => {
    const a = await makeNonce();
    const b = await makeNonce();
    expect(a.raw).not.toBe(b.raw);
  });

  it('hashes like SHA-256', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
