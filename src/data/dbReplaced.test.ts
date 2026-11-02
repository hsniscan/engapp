import Dexie from 'dexie';
import { describe, expect, it, vi } from 'vitest';
import { EngDb, watchDbReplaced } from './db';

describe('watchDbReplaced (ADR 0064)', () => {
  it('closes the old connection for good and asks once for a reload when a newer schema opens', async () => {
    const name = 'replaced-test';
    const old = new EngDb(name);
    await old.open();
    const onReplaced = vi.fn();
    watchDbReplaced(onReplaced, old);

    // A newer version of the app in another tab: same database, higher version.
    const newer = new Dexie(name);
    newer.version(old.verno + 1).stores({ extra_table: 'id' });
    await newer.open();

    expect(onReplaced).toHaveBeenCalledTimes(1);
    expect(old.isOpen()).toBe(false);
    // No silent reopen with the old code's schema.
    await expect(old.notes.count()).rejects.toThrow();
    newer.close();
  });
});
