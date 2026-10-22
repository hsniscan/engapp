// Web Push on this device (v0.3 İP8, docs/decisions/0024-web-push.md): support checks, the
// permission prompt, PushManager subscribe/unsubscribe, registering the subscription with the
// server (push_subscribe / push_unsubscribe: the owner is always the signed-in user) and the
// test notification. Everything browser-specific comes through PushEnv so tests can mock it.
import { backendConfig, getAccessToken, supabase } from '@/lib/supabase';
import { flags, isIos, isStandalone } from '@/features/settings/platform';

/** localStorage key: the user id this browser's subscription was registered for. */
const OWNER_KEY = 'push.owner';

export interface PushEnv {
  serviceWorker: { ready: Promise<{ pushManager: PushManager }> } | null;
  hasPushManager: boolean;
  notification: {
    permission: NotificationPermission;
    requestPermission: () => Promise<NotificationPermission>;
  } | null;
  fetch: typeof fetch;
  config: { url: string; key: string } | null;
  getAccessToken: () => Promise<string | null>;
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ error: { message: string; code?: string } | null }>;
  ios: boolean;
  standalone: boolean;
  userAgent: string;
}

export function browserPushEnv(): PushEnv {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const win = typeof window !== 'undefined' ? window : undefined;
  return {
    serviceWorker:
      nav && 'serviceWorker' in nav ? (nav.serviceWorker as PushEnv['serviceWorker']) : null,
    hasPushManager: !!win && 'PushManager' in win,
    notification: win && 'Notification' in win ? Notification : null,
    fetch: (...a) => fetch(...a),
    config: backendConfig,
    getAccessToken,
    rpc: async (fn, args) => {
      if (!supabase) return { error: { message: 'not configured' } };
      const { error } = await supabase.rpc(fn, args);
      return { error };
    },
    ios: isIos(),
    standalone: isStandalone(),
    userAgent: nav?.userAgent ?? '',
  };
}

export type PushSupport =
  /** Ready to ask. */
  | 'supported'
  /** iPhone/iPad Safari tab: push works only in the installed (home screen) app, iOS 16.4+. */
  | 'ios_needs_install'
  /** This browser has no Web Push. */
  | 'unsupported'
  /** A build without the Supabase backend (guest only). */
  | 'no_backend';

export function pushSupport(env: PushEnv = browserPushEnv()): PushSupport {
  if (!env.config) return 'no_backend';
  if (env.serviceWorker && env.hasPushManager && env.notification) return 'supported';
  if (env.ios && !env.standalone) return 'ios_needs_install';
  return 'unsupported';
}

export function permission(
  env: PushEnv = browserPushEnv(),
): NotificationPermission | 'unsupported' {
  return env.notification?.permission ?? 'unsupported';
}

function functionUrl(env: PushEnv, path: string): string {
  return `${env.config!.url}/functions/v1/push-send${path}`;
}

/** The server's public VAPID key (null: the backend has no keys yet). */
export async function fetchPublicKey(env: PushEnv): Promise<string | null> {
  const res = await env.fetch(functionUrl(env, '/config'));
  if (!res.ok) throw new Error(`push-send/config ${res.status}`);
  const body = (await res.json()) as { public_key?: unknown };
  return typeof body.public_key === 'string' && body.public_key ? body.public_key : null;
}

export function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const b64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return false;
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}

async function registration(
  env: PushEnv,
  timeoutMs = 10_000,
): Promise<{ pushManager: PushManager }> {
  if (!env.serviceWorker) throw new Error('no service worker');
  return Promise.race([
    env.serviceWorker.ready,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('service worker not ready')), timeoutMs),
    ),
  ]);
}

/** This browser's subscription, if any. */
export async function currentSubscription(
  env: PushEnv = browserPushEnv(),
): Promise<PushSubscription | null> {
  if (pushSupport(env) !== 'supported') return null;
  try {
    return await (await registration(env, 3000)).pushManager.getSubscription();
  } catch {
    return null;
  }
}

/** Reminders arrive on this device for this user (subscribed here, registered for them). */
export async function isSubscribedHere(
  userId: string,
  env: PushEnv = browserPushEnv(),
): Promise<boolean> {
  return flags.get(OWNER_KEY) === userId && (await currentSubscription(env)) !== null;
}

export type EnableResult = 'ok' | 'denied' | 'unsupported' | 'not_configured' | 'error';

/**
 * Asks for permission (the browser prompt), subscribes this browser with the server's key and
 * registers the subscription for the signed-in user.
 */
export async function enablePush(
  userId: string,
  env: PushEnv = browserPushEnv(),
): Promise<EnableResult> {
  if (pushSupport(env) !== 'supported') return 'unsupported';
  const perm =
    env.notification!.permission === 'granted'
      ? 'granted'
      : await env.notification!.requestPermission();
  if (perm !== 'granted') return 'denied';
  try {
    const key = await fetchPublicKey(env);
    if (!key) return 'not_configured';
    const appKey = keyBytes(key);
    const { pushManager } = await registration(env);
    let sub = await pushManager.getSubscription();
    if (sub && !sameKey(sub.options?.applicationServerKey, appKey)) {
      await sub.unsubscribe(); // made with an older server key: it would never receive anything
      sub = null;
    }
    sub ??= await pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
    const json = sub.toJSON();
    const { error } = await env.rpc('push_subscribe', {
      p_endpoint: sub.endpoint,
      p_p256dh: json.keys?.p256dh ?? '',
      p_auth: json.keys?.auth ?? '',
      p_user_agent: env.userAgent.slice(0, 300),
    });
    if (error) throw new Error(error.message);
    flags.set(OWNER_KEY, userId);
    return 'ok';
  } catch (e) {
    console.warn('push: enable failed', e);
    return 'error';
  }
}

/**
 * Stops reminders on this device: removes the server row (when signed in and online) and
 * unsubscribes the browser. Unsubscribing alone already stops delivery: the push service
 * answers 410 and the server deletes the row on its next send.
 */
export async function disablePush(
  env: PushEnv = browserPushEnv(),
  opts: { server?: boolean } = {},
): Promise<void> {
  const sub = await currentSubscription(env);
  flags.set(OWNER_KEY, '');
  if (!sub) return;
  if (opts.server !== false) {
    try {
      await env.rpc('push_unsubscribe', { p_endpoint: sub.endpoint });
    } catch {
      // offline: the 410 path cleans up
    }
  }
  await sub.unsubscribe().catch(() => false);
}

export type TestResult = 'sent' | 'not_subscribed' | 'gone' | 'offline' | 'error';

/** Asks the server to send one test notification to this device. */
export async function sendTestNotification(env: PushEnv = browserPushEnv()): Promise<TestResult> {
  const sub = await currentSubscription(env);
  if (!sub) return 'not_subscribed';
  const token = await env.getAccessToken();
  if (!token) return 'error';
  let res: Response;
  try {
    res = await env.fetch(functionUrl(env, '/test'), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        apikey: env.config!.key,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
  } catch {
    return 'offline';
  }
  if (res.status === 400) return 'not_subscribed';
  if (!res.ok) return 'error';
  const body = (await res.json()) as { delivered?: boolean; gone?: boolean };
  return body.delivered ? 'sent' : body.gone ? 'gone' : 'error';
}

/** Another account signed in (or the user signed out): this browser's subscription is not theirs. */
export async function dropForeignSubscription(
  userId: string | null,
  env: PushEnv = browserPushEnv(),
): Promise<void> {
  const owner = flags.get(OWNER_KEY);
  if (!owner || owner === userId) return;
  // The previous account's session is gone, so only the browser side can be undone here; the
  // server row is removed on the next send (410) or reassigned if this user turns reminders on.
  await disablePush(env, { server: false });
}

export function isAndroid(env: PushEnv = browserPushEnv()): boolean {
  return /Android/i.test(env.userAgent);
}
