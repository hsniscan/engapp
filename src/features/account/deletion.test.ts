import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addNoteWithSenses, db, getCurrentUserId, META, setMeta } from '@/data';
import { resetDb } from '@/test/db';
import { ACCOUNT_DELETE_CONFIRM } from '../../../supabase/functions/_shared/account-delete-contract';
import {
  deleteAccount,
  DeletionError,
  requestAccountDeletion,
  wipeDeviceData,
  type DeletionDeps,
} from './deletion';

const USER = '0199f0a0-0000-7000-8000-00000000d101';
const OTHER = '0199f0a0-0000-7000-8000-00000000d102';
const config = { url: 'https://example.supabase.co', key: 'sb_publishable_test' };
const ok = {
  deleted: true,
  account: 'deleted',
  rows: { notes: 2, review_logs: 5 },
  files: 0,
};

function deps(over: Partial<DeletionDeps> = {}): DeletionDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    config,
    getAccessToken: async () => 'token-1',
    getUserId: async () => USER,
    fetch: vi.fn(async () => {
      calls.push('server');
      return new Response(JSON.stringify(ok), { status: 200 });
    }) as unknown as typeof fetch,
    wipeDevice: async () => {
      calls.push('wipe');
    },
    signOut: async () => {
      calls.push('signOut');
    },
    ...over,
  };
}

beforeEach(async () => {
  await resetDb();
});

describe('requestAccountDeletion', () => {
  it('posts the confirmation phrase with the session token and parses the answer', async () => {
    const d = deps();
    const res = await requestAccountDeletion(d);
    expect(res).toEqual(ok);
    const [url, init] = vi.mocked(d.fetch!).mock.calls[0]!;
    expect(url).toBe('https://example.supabase.co/functions/v1/account-delete');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer token-1');
    expect(JSON.parse(String(init?.body))).toEqual({ confirm: ACCOUNT_DELETE_CONFIRM });
  });

  it.each([
    ['no backend', { config: null }, 'not_configured'],
    ['no session', { getAccessToken: async () => null }, 'not_signed_in'],
    [
      'network down',
      {
        fetch: (async () => {
          throw new TypeError('Failed to fetch');
        }) as unknown as typeof fetch,
      },
      'offline',
    ],
    [
      'expired token',
      { fetch: (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch },
      'not_signed_in',
    ],
    [
      'server error',
      {
        fetch: (async () =>
          new Response(JSON.stringify({ error: { code: 'internal' } }), {
            status: 500,
          })) as unknown as typeof fetch,
      },
      'server',
    ],
    [
      'answer outside the contract',
      { fetch: (async () => new Response('{"ok":1}', { status: 200 })) as unknown as typeof fetch },
      'server',
    ],
  ] as const)('%s → %s', async (_name, over, code) => {
    await expect(requestAccountDeletion(deps(over as Partial<DeletionDeps>))).rejects.toMatchObject({
      code,
    });
  });
});

describe('deleteAccount', () => {
  it('server first, then the device wipe, then sign-out', async () => {
    const d = deps();
    const res = await deleteAccount({ wipe: 'always' }, d);
    expect(d.calls).toEqual(['server', 'wipe', 'signOut']);
    expect(res.wiped).toBe(true);
  });

  it('nothing local is touched when the server call fails', async () => {
    const d = deps({
      fetch: (async () => {
        throw new TypeError('offline');
      }) as unknown as typeof fetch,
    });
    await expect(deleteAccount({ wipe: 'always' }, d)).rejects.toBeInstanceOf(DeletionError);
    expect(d.calls).toEqual([]);
  });

  it('web page: wipes this browser only when its data belongs to the deleted account', async () => {
    await db.transaction('rw', db.meta, () => setMeta(META.userId, OTHER));
    const d = deps();
    expect((await deleteAccount({ wipe: 'if-linked' }, d)).wiped).toBe(false);
    expect(d.calls).toEqual(['server', 'signOut']);

    await db.transaction('rw', db.meta, () => setMeta(META.userId, USER));
    const d2 = deps();
    expect((await deleteAccount({ wipe: 'if-linked' }, d2)).wiped).toBe(true);
    expect(d2.calls).toEqual(['server', 'wipe', 'signOut']);
  });

  it('still signs out when the local wipe fails (the account is gone already)', async () => {
    const d = deps({
      wipeDevice: async () => {
        throw new Error('blocked');
      },
    });
    await deleteAccount({ wipe: 'always' }, d);
    expect(d.calls).toEqual(['server', 'signOut']);
  });
});

describe('wipeDeviceData', () => {
  it('empties every local table, the audio cache and the app keys in localStorage', async () => {
    await addNoteWithSenses({ term: 'reluctant', senses: [{ meaning_tr: 'isteksiz' }] });
    await db.transaction('rw', db.meta, () => setMeta(META.userId, USER));
    localStorage.setItem('engapp.theme', 'dark');
    localStorage.setItem('engapp.push_owner', USER);
    localStorage.setItem('other-site-key', 'kept');
    const deleted: string[] = [];
    vi.stubGlobal('caches', { delete: async (n: string) => (deleted.push(n), true) });
    try {
      expect(await db.notes.count()).toBe(1);
      await wipeDeviceData();
      for (const t of db.tables) expect(await t.count(), t.name).toBe(0);
      expect(await getCurrentUserId()).toBeNull();
      expect(deleted).toEqual(['engapp-tts']);
      expect(localStorage.getItem('engapp.theme')).toBeNull();
      expect(localStorage.getItem('engapp.push_owner')).toBeNull();
      expect(localStorage.getItem('other-site-key')).toBe('kept');
    } finally {
      vi.unstubAllGlobals();
      localStorage.removeItem('other-site-key');
    }
  });
});
