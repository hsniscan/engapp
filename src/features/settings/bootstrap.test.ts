import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/data/db';
import { resetDb } from '@/test/db';
import type { Note } from '@/domain/types';

const toast = vi.fn();
vi.mock('@/ui', async (orig) => ({ ...(await orig<typeof import('@/ui')>()), toast }));
const requestPersistence = vi.fn(async () => false);
vi.mock('./platform', async (orig) => ({
  ...(await orig<typeof import('./platform')>()),
  requestPersistence,
}));
const { PERSIST_RETRY_MS, watchFirstCard } = await import('./bootstrap');
const DAY = 86_400_000;

beforeEach(async () => {
  await resetDb();
  localStorage.clear();
  toast.mockClear();
  requestPersistence.mockClear();
});

async function firstNote() {
  // Only the count matters here.
  await db.notes.add({ id: 'n1', term_norm: 'serendipity' } as unknown as Note);
}

describe('watchFirstCard (first note on the device)', () => {
  it('web: asks for persistent storage on the first note, and never shows a toast (A5)', async () => {
    const stop = watchFirstCard(() => false);
    await firstNote();
    await vi.waitFor(() => expect(requestPersistence).toHaveBeenCalledTimes(1));
    stop();
    expect(toast).not.toHaveBeenCalled();
  });

  it('asks again at most weekly while the browser says no', async () => {
    const T = Date.UTC(2026, 10, 5);
    localStorage.setItem('engapp.persistAsked', '1');
    localStorage.setItem('engapp.persistAskedAt', String(T));
    const persisted = vi.fn(async () => false);
    vi.stubGlobal('navigator', { ...navigator, storage: { persist: vi.fn(), persisted, estimate: async () => ({}) } });
    try {
      watchFirstCard(() => false, () => T + DAY);
      await vi.waitFor(() => expect(persisted).toHaveBeenCalled());
      await new Promise((r) => setTimeout(r, 0));
      expect(requestPersistence).not.toHaveBeenCalled();
      watchFirstCard(() => false, () => T + PERSIST_RETRY_MS + DAY);
      await vi.waitFor(() => expect(requestPersistence).toHaveBeenCalledTimes(1));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('Android app: nothing to ask, nothing shown (the notice lives in Profil)', async () => {
    const stop = watchFirstCard(() => true);
    await firstNote();
    await new Promise((r) => setTimeout(r, 20));
    stop();
    expect(requestPersistence).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });
});
