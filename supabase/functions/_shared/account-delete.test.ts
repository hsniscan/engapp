// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { runAccountDelete, type AccountDeleteStore } from './account-delete.ts';
import { ACCOUNT_DELETE_CONFIRM, accountDeleteResponse } from './account-delete-contract.ts';
import { removeUserFiles, type StorageApi } from './account-delete-store.ts';
import { ApiError } from './errors.ts';

const USER = '0199f0a0-0000-7000-8000-00000000d001';
const OTHER = '0199f0a0-0000-7000-8000-00000000d002';

/** In-memory backend: rows per user and table, files per bucket, auth users. */
function fakeStore() {
  const rows = new Map<string, Map<string, number>>([
    [USER, new Map([['notes', 3], ['review_logs', 12], ['push_subscriptions', 1]])],
    [OTHER, new Map([['notes', 5]])],
  ]);
  const users = new Set([USER, OTHER]);
  const order: string[] = [];
  const store: AccountDeleteStore = {
    removeUserFiles: vi.fn(async () => {
      order.push('files');
      return 0;
    }),
    deleteUserRows: vi.fn(async (id: string) => {
      order.push('rows');
      const r = Object.fromEntries(rows.get(id) ?? []);
      rows.delete(id);
      return r;
    }),
    deleteAuthUser: vi.fn(async (id: string) => {
      order.push('auth');
      return users.delete(id) ? ('deleted' as const) : ('not_found' as const);
    }),
  };
  return { store, rows, users, order };
}

const body = { confirm: ACCOUNT_DELETE_CONFIRM };

describe('runAccountDelete', () => {
  it('deletes files, then rows, then the auth user, and reports counts', async () => {
    const f = fakeStore();
    const res = await runAccountDelete(body, { userId: USER, store: f.store });
    expect(accountDeleteResponse.parse(res)).toEqual({
      deleted: true,
      account: 'deleted',
      rows: { notes: 3, review_logs: 12, push_subscriptions: 1 },
      files: 0,
    });
    expect(f.order).toEqual(['files', 'rows', 'auth']);
    expect(f.rows.has(USER)).toBe(false);
    expect(f.users.has(USER)).toBe(false);
  });

  it('never touches another user', async () => {
    const f = fakeStore();
    await runAccountDelete(body, { userId: USER, store: f.store });
    expect(f.rows.get(OTHER)?.get('notes')).toBe(5);
    expect(f.users.has(OTHER)).toBe(true);
    for (const fn of Object.values(f.store))
      for (const call of (fn as ReturnType<typeof vi.fn>).mock.calls) expect(call[0]).toBe(USER);
  });

  it('is idempotent: a second call succeeds with already_gone and nothing left', async () => {
    const f = fakeStore();
    await runAccountDelete(body, { userId: USER, store: f.store });
    const again = await runAccountDelete(body, { userId: USER, store: f.store });
    expect(again).toEqual({ deleted: true, account: 'already_gone', rows: {}, files: 0 });
  });

  it('a failure part-way can be retried to completion', async () => {
    const f = fakeStore();
    vi.mocked(f.store.deleteAuthUser).mockRejectedValueOnce(new Error('auth down'));
    await expect(runAccountDelete(body, { userId: USER, store: f.store })).rejects.toThrow('auth down');
    expect(f.rows.has(USER)).toBe(false); // the data went first
    const res = await runAccountDelete(body, { userId: USER, store: f.store });
    expect(res.account).toBe('deleted');
    expect(f.users.has(USER)).toBe(false);
  });

  it.each([null, {}, { confirm: 'yes' }, { confirm: true }, 'delete'])(
    'refuses a body without the confirmation phrase (%j) before touching anything',
    async (b) => {
      const f = fakeStore();
      await expect(runAccountDelete(b, { userId: USER, store: f.store })).rejects.toMatchObject({
        code: 'invalid_input',
      });
      expect(f.order).toEqual([]);
    },
  );

  it('refuses a user id that is not a UUID (never a storage prefix like "" or "..")', async () => {
    const f = fakeStore();
    for (const id of ['', '..', 'a/b', `${USER}/x`]) {
      await expect(runAccountDelete(body, { userId: id, store: f.store })).rejects.toBeInstanceOf(
        ApiError,
      );
    }
    expect(f.order).toEqual([]);
  });

  it('logs counts only, never the user id', async () => {
    const f = fakeStore();
    const log = vi.fn();
    await runAccountDelete(body, { userId: USER, store: f.store, log });
    expect(JSON.stringify(log.mock.calls)).not.toContain(USER);
    expect(log).toHaveBeenCalledWith('account deleted', {
      account: 'deleted',
      files: 0,
      tables: 3,
      rows: 16,
    });
  });
});

describe('removeUserFiles', () => {
  function fakeStorage(files: Record<string, string[]>) {
    const removed: string[] = [];
    const api: StorageApi = {
      listBuckets: async () => ({ data: Object.keys(files).map((id) => ({ id })), error: null }),
      from: (bucket) => ({
        list: async (prefix, { limit, offset }) => {
          const under = (files[bucket] ?? []).filter((p) => p.startsWith(`${prefix}/`));
          const names = new Map<string, string | null>();
          for (const p of under) {
            const rest = p.slice(prefix.length + 1);
            const [head, ...tail] = rest.split('/');
            names.set(head!, tail.length ? null : 'file');
          }
          const entries = [...names].map(([name, id]) => ({ name, id }));
          return { data: entries.slice(offset, offset + limit), error: null };
        },
        remove: async (paths) => {
          removed.push(...paths.map((p) => `${bucket}:${p}`));
          files[bucket] = (files[bucket] ?? []).filter((p) => !paths.includes(p));
          return { error: null };
        },
      }),
    };
    return { api, removed, files };
  }

  it('removes only objects under "<user id>/" in every bucket, folders included', async () => {
    const s = fakeStorage({
      tts: ['en-US/abc.wav', 'en-GB/def.wav'],
      uploads: [`${USER}/a.json`, `${USER}/deep/b.png`, `${OTHER}/c.json`],
    });
    expect(await removeUserFiles(s.api, USER)).toBe(2);
    expect(s.removed.sort()).toEqual([`uploads:${USER}/a.json`, `uploads:${USER}/deep/b.png`]);
    expect(s.files.tts).toHaveLength(2); // shared audio stays
    expect(s.files.uploads).toEqual([`${OTHER}/c.json`]);
    expect(await removeUserFiles(s.api, USER)).toBe(0); // idempotent
  });
});
