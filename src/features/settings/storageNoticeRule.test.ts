import { describe, expect, it } from 'vitest';
import { shouldShowStorageNotice, STORAGE_NOTICE_HIDE_MS } from './storageNoticeRule';

const base = { guest: true, native: false, persisted: false as boolean | null, hiddenAt: null, now: 1e12 };

describe('shouldShowStorageNotice (Profil, A5)', () => {
  it('a web guest whose browser did not agree to keep the data', () => {
    expect(shouldShowStorageNotice(base)).toBe(true);
    expect(shouldShowStorageNotice({ ...base, persisted: true })).toBe(false);
    // Unknown (unsupported browser): no claim either way.
    expect(shouldShowStorageNotice({ ...base, persisted: null })).toBe(false);
  });

  it('every guest of the Android app; never a signed-in user', () => {
    expect(shouldShowStorageNotice({ ...base, native: true, persisted: null })).toBe(true);
    expect(shouldShowStorageNotice({ ...base, guest: false })).toBe(false);
  });

  it('closed: hidden for 30 days, then back', () => {
    expect(shouldShowStorageNotice({ ...base, hiddenAt: base.now - 1000 })).toBe(false);
    expect(shouldShowStorageNotice({ ...base, hiddenAt: base.now - STORAGE_NOTICE_HIDE_MS })).toBe(true);
  });
});
