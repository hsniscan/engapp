// push-send edge function (v0.3 İP8, docs/decisions/0024-web-push.md). Environment-neutral:
// the Deno entrypoint (supabase/functions/push-send/index.ts) wires the real store, tests use
// an in-memory one.
//
//   GET  /push-send/config  public: {public_key} for PushManager.subscribe (null until the
//                           deploy workflow has set the VAPID keys)
//   POST /push-send/test    signed-in user: one test notification to this device's
//                           subscription (body {endpoint}; must be the caller's own)
//   POST /push-send         the scheduled job (pg_cron + pg_net every 15 minutes), with the
//                           database's own token as bearer: sends the day's reminders.

import { ApiError } from './errors.ts';
import { bearerToken, corsHeaders, errorResponse, json, type CorsConfig } from './http.ts';
import {
  decidePush,
  pushSlot,
  TEST_MESSAGE,
  type PushCandidate,
  type PushMessage,
  type SkipReason,
} from './push-rule.ts';
import {
  isAllowedPushEndpoint,
  sendWebPush,
  type PushTarget,
  type SendOutcome,
  type VapidKeys,
} from './webpush.ts';

export interface StoredSubscription extends PushTarget {
  id: string;
}

export interface CandidateRow extends PushCandidate {
  user_id: string;
  subscriptions: StoredSubscription[];
}

export interface DueRow {
  user_id: string;
  due: number;
  /** Median seconds per review over the last 30 days; null without history. */
  sec_per_card: number | null;
}

export interface PushStore {
  /** Users with notify.enabled and at least one subscription. */
  candidates(): Promise<CandidateRow[]>;
  /** Reviews due before each user's `until` (end of their day), from the synced cards. */
  dueCounts(items: { user_id: string; until: number }[]): Promise<DueRow[]>;
  /** Records the day's reminder; false when one was already recorded (another run won). */
  claim(userId: string, day: string, due: number): Promise<boolean>;
  /** Delivery result of a claimed reminder. */
  finish(userId: string, day: string, delivered: number, failed: number): Promise<void>;
  /** Subscriptions the push service says no longer exist. */
  removeSubscriptions(ids: string[]): Promise<void>;
  /** Successful deliveries (resets the failure count) and failures (counted). */
  markDelivery(okIds: string[], failedIds: string[]): Promise<void>;
  subscriptionOf(userId: string, endpoint: string): Promise<StoredSubscription | null>;
  checkCronToken(token: string): Promise<boolean>;
}

export type Sender = (target: PushTarget, message: PushMessage) => Promise<SendOutcome>;

export interface TickResult {
  candidates: number;
  sent: number;
  delivered: number;
  failed: number;
  removed: number;
  skipped: Partial<Record<SkipReason | 'claimed_elsewhere', number>>;
}

const CONCURRENCY = 8;

async function inBatches<T>(items: T[], fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    await Promise.all(items.slice(i, i + CONCURRENCY).map(fn));
  }
}

/** One run of the scheduled job. */
export async function runPushTick(
  store: PushStore,
  send: Sender,
  now: number,
): Promise<TickResult> {
  const result: TickResult = {
    candidates: 0,
    sent: 0,
    delivered: 0,
    failed: 0,
    removed: 0,
    skipped: {},
  };
  const skip = (r: SkipReason | 'claimed_elsewhere') => {
    result.skipped[r] = (result.skipped[r] ?? 0) + 1;
  };
  const candidates = await store.candidates();
  result.candidates = candidates.length;

  const open: { c: CandidateRow; until: number }[] = [];
  for (const c of candidates) {
    const slot = pushSlot(c, now);
    if (slot.ok) open.push({ c, until: slot.dayEnd });
    else skip(slot.reason);
  }
  if (open.length === 0) return result;

  const due = new Map(
    (await store.dueCounts(open.map(({ c, until }) => ({ user_id: c.user_id, until })))).map(
      (d) => [d.user_id, d],
    ),
  );
  const gone: string[] = [];
  const ok: string[] = [];
  const bad: string[] = [];
  await inBatches(open, async ({ c }) => {
    const d = due.get(c.user_id);
    const decision = decidePush(c, now, d?.due ?? 0, d?.sec_per_card ?? null);
    if (!decision.send) return skip(decision.reason);
    // Claim first: at most one reminder per user-day even if two runs overlap.
    if (!(await store.claim(c.user_id, decision.day, d?.due ?? 0)))
      return skip('claimed_elsewhere');
    result.sent++;
    let delivered = 0;
    let failed = 0;
    for (const sub of c.subscriptions) {
      const out = await send(sub, decision.message);
      if (out.kind === 'ok') {
        delivered++;
        ok.push(sub.id);
      } else if (out.kind === 'gone') {
        gone.push(sub.id);
      } else {
        failed++;
        bad.push(sub.id);
      }
    }
    result.delivered += delivered;
    result.failed += failed;
    await store.finish(c.user_id, decision.day, delivered, failed);
  });
  if (gone.length) await store.removeSubscriptions(gone);
  if (ok.length || bad.length) await store.markDelivery(ok, bad);
  result.removed = gone.length;
  return result;
}

/** The test notification from Settings → Bildirim: only to the caller's own subscription. */
export async function sendTestPush(
  store: PushStore,
  send: Sender,
  userId: string,
  body: unknown,
): Promise<{ delivered: boolean; gone: boolean }> {
  const endpoint = (body as { endpoint?: unknown } | null)?.endpoint;
  if (typeof endpoint !== 'string' || !isAllowedPushEndpoint(endpoint)) {
    throw new ApiError('invalid_input', 'endpoint must be a push service URL');
  }
  const sub = await store.subscriptionOf(userId, endpoint);
  if (!sub) throw new ApiError('invalid_input', 'This device is not subscribed');
  const out = await send(sub, TEST_MESSAGE);
  if (out.kind === 'gone') await store.removeSubscriptions([sub.id]);
  return { delivered: out.kind === 'ok', gone: out.kind === 'gone' };
}

export function vapidFromEnv(env: (k: string) => string | undefined): VapidKeys | null {
  const publicKey = env('VAPID_PUBLIC_KEY')?.trim();
  const privateKey = env('VAPID_PRIVATE_KEY')?.trim();
  if (!publicKey || !privateKey) return null;
  return {
    publicKey,
    privateKey,
    subject: env('VAPID_SUBJECT')?.trim() || 'https://engapp-65y.pages.dev',
  };
}

export function webPushSender(keys: VapidKeys, fetchImpl?: typeof fetch): Sender {
  return (target, message) =>
    sendWebPush(target, message, keys, {
      fetch: fetchImpl,
      // A reminder is only useful today; a test notification only right now.
      ttl: message.tag === 'engapp-test' ? 600 : 6 * 3600,
      topic: message.tag,
    });
}

export interface PushHandlerOptions {
  cors: CorsConfig;
  store: PushStore;
  vapid: VapidKeys | null;
  /** Returns the caller's user id or throws ApiError('unauthorized'). */
  authenticate: (req: Request) => Promise<string>;
  send?: Sender;
  now?: () => number;
  log?: (m: string, d?: Record<string, unknown>) => void;
}

export function createPushHandler(opts: PushHandlerOptions): (req: Request) => Promise<Response> {
  const send = opts.send ?? (opts.vapid ? webPushSender(opts.vapid) : null);
  return async (req) => {
    const cors = {
      ...corsHeaders(req, opts.cors),
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const path = new URL(req.url).pathname.replace(/\/+$/, '');
    try {
      if (path.endsWith('/config')) {
        if (req.method !== 'GET') throw new ApiError('method_not_allowed', 'Use GET');
        return json({ public_key: opts.vapid?.publicKey ?? null }, 200, {
          ...cors,
          'Cache-Control': 'public, max-age=300',
        });
      }
      if (req.method !== 'POST') throw new ApiError('method_not_allowed', 'Use POST');
      if (!send) {
        opts.log?.('VAPID keys are not set');
        return json(
          { error: { code: 'internal', message: 'Push is not configured yet' } },
          503,
          cors,
        );
      }
      if (path.endsWith('/test')) {
        const userId = await opts.authenticate(req);
        let body: unknown;
        try {
          body = JSON.parse(await req.text());
        } catch {
          throw new ApiError('invalid_input', 'Body must be JSON');
        }
        return json(await sendTestPush(opts.store, send, userId, body), 200, cors);
      }
      // The scheduled job. Its token lives in the database (push_cron_config); nothing else
      // can start a run.
      const token = bearerToken(req);
      if (!token || !(await opts.store.checkCronToken(token)))
        throw new ApiError('unauthorized', 'Not the scheduler');
      const result = await runPushTick(opts.store, send, (opts.now ?? Date.now)());
      opts.log?.('tick', { ...result });
      return json(result, 200);
    } catch (e) {
      return errorResponse(e, cors, opts.log);
    }
  };
}
