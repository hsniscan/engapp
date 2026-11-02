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
const { watchFirstCard } = await import('./bootstrap');

beforeEach(async () => {
  await resetDb();
  localStorage.clear();
  toast.mockClear();
  requestPersistence.mockClear();
});

async function firstNote() {
  // Only the count matters here.
  await db.notes.add({ id: 'n1', term_norm: 'serendipity' } as unknown as Note);
  await vi.waitFor(() => expect(toast).toHaveBeenCalled());
}

describe('watchFirstCard (first note on the device)', () => {
  it('web guest: asks for persistent storage and warns when the browser says no', async () => {
    const stop = watchFirstCard(() => false);
    await firstNote();
    stop();
    expect(requestPersistence).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0]![0]).toMatchObject({ tone: 'warn' });
  });

  it('Android app guest: no persist() and no browser warning, a neutral uninstall note (ADR 0064)', async () => {
    const stop = watchFirstCard(() => true);
    await firstNote();
    stop();
    expect(requestPersistence).not.toHaveBeenCalled();
    const shown = toast.mock.calls[0]![0] as { title: string; tone: string; description: string };
    expect(shown.tone).toBe('neutral');
    expect(shown.description).toMatch(/kaldırırsan/);
    expect(shown.description).not.toMatch(/tarayıcı/i);
  });
});
