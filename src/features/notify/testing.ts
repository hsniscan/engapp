// A fake browser for the push tests: PushManager, Notification permission, the push-send
// function and the two RPCs.
import { vi } from 'vitest';
import type { PushEnv } from './push';

export const SERVER_KEY =
  'BDNPg_bUc1DAJOXR5gtmV5Mnk6pglLbL_f-fEaxuVth-fHx6gNPY6xM9Kyk3fGzqiWUDN5volRVJdUUfEidwNkA';

export interface FakeBrowser {
  env: PushEnv;
  /** The browser's current subscription. */
  sub: { endpoint: string; unsubscribed: boolean } | null;
  rpc: ReturnType<typeof vi.fn>;
  fetch: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  setPermission(p: NotificationPermission, answer?: NotificationPermission): void;
}

export function fakeBrowser(
  over: Partial<PushEnv> & { publicKey?: string | null; testReply?: unknown } = {},
): FakeBrowser {
  let perm: NotificationPermission = 'default';
  let answer: NotificationPermission = 'granted';
  let n = 0;
  const fb = { sub: null } as FakeBrowser;
  const makeSub = (key: BufferSource | null) => {
    const endpoint = `https://fcm.googleapis.com/fcm/send/device-${++n}`;
    const s = { endpoint, unsubscribed: false };
    fb.sub = s;
    return {
      endpoint,
      options: {
        applicationServerKey: key ? (key as Uint8Array).buffer : null,
        userVisibleOnly: true,
      },
      toJSON: () => ({ endpoint, keys: { p256dh: 'P'.repeat(87), auth: 'A'.repeat(22) } }),
      unsubscribe: async () => {
        s.unsubscribed = true;
        if (fb.sub === s) fb.sub = null;
        return true;
      },
    };
  };
  let current: ReturnType<typeof makeSub> | null = null;
  fb.subscribe = vi.fn(
    async (opts: PushSubscriptionOptionsInit) =>
      (current = makeSub(opts.applicationServerKey as BufferSource)),
  );
  const pushManager = {
    getSubscription: async () => (fb.sub && current && !fb.sub.unsubscribed ? current : null),
    subscribe: fb.subscribe,
  } as unknown as PushManager;
  fb.rpc = vi.fn(async () => ({ error: null }));
  fb.fetch = vi.fn(async (url: string) => {
    if (url.endsWith('/config'))
      return new Response(
        JSON.stringify({ public_key: over.publicKey === undefined ? SERVER_KEY : over.publicKey }),
      );
    if (url.endsWith('/test'))
      return new Response(JSON.stringify(over.testReply ?? { delivered: true, gone: false }));
    return new Response('{}', { status: 404 });
  });
  fb.setPermission = (p, a = answer) => {
    perm = p;
    answer = a;
  };
  fb.env = {
    serviceWorker: { ready: Promise.resolve({ pushManager }) },
    hasPushManager: true,
    notification: {
      get permission() {
        return perm;
      },
      requestPermission: async () => (perm = answer),
    },
    fetch: fb.fetch as unknown as typeof fetch,
    config: { url: 'https://proj.supabase.co', key: 'sb_publishable_x' },
    getAccessToken: async () => 'token-1',
    rpc: fb.rpc as unknown as PushEnv['rpc'],
    ios: false,
    standalone: false,
    userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/140',
    ...over,
  };
  return fb;
}
