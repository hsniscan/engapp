// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ApiError } from './errors.ts';
import {
  createPushHandler,
  runPushTick,
  vapidFromEnv,
  type CandidateRow,
  type DueRow,
  type PushStore,
  type Sender,
  type StoredSubscription,
} from './push-send.ts';
import type { PushMessage } from './push-rule.ts';

const ORIGIN = 'https://engapp.example';
const NOW = Date.parse('2026-10-23T19:05:00+03:00');
const sub = (id: string): StoredSubscription => ({
  id,
  endpoint: `https://fcm.googleapis.com/fcm/send/${id}`,
  p256dh: 'B'.repeat(87),
  auth: 'A'.repeat(22),
});

class MemoryPushStore implements PushStore {
  rows: CandidateRow[] = [];
  due = new Map<string, number>();
  log = new Map<string, { due: number; delivered?: number; failed?: number }>();
  removed: string[] = [];
  delivery = { ok: [] as string[], failed: [] as string[] };
  token = 'cron-secret';
  dueQueries: { user_id: string; until: number }[] = [];

  async candidates() {
    return this.rows.map((r) => ({
      ...r,
      last_push_day:
        [...this.log.keys()]
          .filter((k) => k.startsWith(`${r.user_id}|`))
          .map((k) => k.split('|')[1]!)
          .sort()
          .at(-1) ?? null,
      subscriptions: r.subscriptions.filter((s) => !this.removed.includes(s.id)),
    }));
  }
  async dueCounts(items: { user_id: string; until: number }[]): Promise<DueRow[]> {
    this.dueQueries.push(...items);
    return items.map((i) => ({
      user_id: i.user_id,
      due: this.due.get(i.user_id) ?? 0,
      sec_per_card: 15,
    }));
  }
  async claim(userId: string, day: string, due: number) {
    const k = `${userId}|${day}`;
    if (this.log.has(k)) return false;
    this.log.set(k, { due });
    return true;
  }
  async finish(userId: string, day: string, delivered: number, failed: number) {
    Object.assign(this.log.get(`${userId}|${day}`)!, { delivered, failed });
  }
  async removeSubscriptions(ids: string[]) {
    this.removed.push(...ids);
  }
  async markDelivery(ok: string[], failed: string[]) {
    this.delivery.ok.push(...ok);
    this.delivery.failed.push(...failed);
  }
  async subscriptionOf(userId: string, endpoint: string) {
    const row = this.rows.find((r) => r.user_id === userId);
    return (
      row?.subscriptions.find((s) => s.endpoint === endpoint && !this.removed.includes(s.id)) ??
      null
    );
  }
  async checkCronToken(token: string) {
    return token === this.token;
  }
}

function user(id: string, over: Partial<CandidateRow> = {}): CandidateRow {
  return {
    user_id: id,
    timezone: 'Europe/Istanbul',
    day_start_hour: 4,
    notify: { enabled: true, mode: 'auto', hour: 19 },
    vacation: null,
    last_review_at: null,
    last_push_day: null,
    subscriptions: [sub(`${id}-phone`)],
    ...over,
  };
}

function recorder(outcome: (s: StoredSubscription) => 'ok' | 'gone' | 'failed' = () => 'ok') {
  const sent: { id: string; message: PushMessage }[] = [];
  const send: Sender = async (t, message) => {
    const s = t as StoredSubscription;
    sent.push({ id: s.id, message });
    const k = outcome(s);
    return k === 'ok'
      ? { kind: 'ok', status: 201 }
      : k === 'gone'
        ? { kind: 'gone', status: 410 }
        : { kind: 'failed', status: 500, detail: '' };
  };
  return { sent, send };
}

describe('runPushTick', () => {
  it('sends one reminder per eligible user and records the day', async () => {
    const store = new MemoryPushStore();
    store.rows = [
      user('a', { subscriptions: [sub('a-phone'), sub('a-laptop')] }),
      user('b', { last_review_at: Date.parse('2026-10-23T08:00:00+03:00') }), // reviewed today
      user('c'), // nothing due
      user('d', { notify: { enabled: true, mode: 'fixed', hour: 21 } }), // later
    ];
    store.due.set('a', 23).set('b', 5);
    const { sent, send } = recorder();
    const r = await runPushTick(store, send, NOW);
    expect(sent.map((s) => s.id)).toEqual(['a-phone', 'a-laptop']);
    expect(sent[0]!.message.body).toBe('Bugün 23 tekrar seni bekliyor (~6 dk)');
    expect(r).toMatchObject({ candidates: 4, sent: 1, delivered: 2, failed: 0, removed: 0 });
    expect(r.skipped).toEqual({ reviewed_today: 1, nothing_due: 1, before_hour: 1 });
    expect(store.log.get('a|2026-10-23')).toEqual({ due: 23, delivered: 2, failed: 0 });
    // The due count is asked only for users in their slot, up to the end of their day.
    expect(store.dueQueries).toEqual([
      { user_id: 'a', until: Date.parse('2026-10-24T04:00:00+03:00') },
      { user_id: 'c', until: Date.parse('2026-10-24T04:00:00+03:00') },
    ]);
  });

  it('never sends twice on the same user day, across runs', async () => {
    const store = new MemoryPushStore();
    store.rows = [user('a')];
    store.due.set('a', 3);
    const { sent, send } = recorder();
    await runPushTick(store, send, NOW);
    await runPushTick(store, send, NOW + 15 * 60_000);
    await runPushTick(store, send, NOW + 2 * 3600_000);
    expect(sent).toHaveLength(1);
    // The next user day sends again.
    await runPushTick(store, send, NOW + 24 * 3600_000);
    expect(sent).toHaveLength(2);
  });

  it('does not send when another run claimed the day first', async () => {
    const store = new MemoryPushStore();
    store.rows = [user('a')];
    store.due.set('a', 3);
    store.claim = async () => false;
    const { sent, send } = recorder();
    const r = await runPushTick(store, send, NOW);
    expect(sent).toHaveLength(0);
    expect(r.skipped).toEqual({ claimed_elsewhere: 1 });
  });

  it('removes gone subscriptions and counts failures', async () => {
    const store = new MemoryPushStore();
    store.rows = [user('a', { subscriptions: [sub('ok'), sub('gone'), sub('bad')] })];
    store.due.set('a', 3);
    const { send } = recorder((s) => (s.id === 'gone' ? 'gone' : s.id === 'bad' ? 'failed' : 'ok'));
    const r = await runPushTick(store, send, NOW);
    expect(r).toMatchObject({ delivered: 1, failed: 1, removed: 1 });
    expect(store.removed).toEqual(['gone']);
    expect(store.delivery).toEqual({ ok: ['ok'], failed: ['bad'] });
  });

  it('stays quiet at night', async () => {
    const store = new MemoryPushStore();
    store.rows = [user('a', { notify: { enabled: true, mode: 'fixed', hour: 9 } })];
    store.due.set('a', 3);
    const { sent, send } = recorder();
    await runPushTick(store, send, Date.parse('2026-10-23T22:00:00+03:00'));
    await runPushTick(store, send, Date.parse('2026-10-24T08:45:00+03:00'));
    expect(sent).toHaveLength(0);
    await runPushTick(store, send, Date.parse('2026-10-24T09:00:00+03:00'));
    expect(sent).toHaveLength(1);
  });
});

describe('handler', () => {
  function setup(over: { vapid?: boolean } = {}) {
    const store = new MemoryPushStore();
    store.rows = [user('u1')];
    store.due.set('u1', 4);
    const rec = recorder();
    const h = createPushHandler({
      cors: { allowedOrigins: [ORIGIN] },
      store,
      vapid:
        over.vapid === false
          ? null
          : { publicKey: 'PUB', privateKey: 'PRIV', subject: 'https://x' },
      authenticate: async (req) => {
        if (req.headers.get('authorization') !== 'Bearer user-token')
          throw new ApiError('unauthorized', 'Sign in');
        return 'u1';
      },
      send: over.vapid === false ? undefined : rec.send,
      now: () => NOW,
    });
    return { store, h, ...rec };
  }
  const url = (p = '') => `http://x/push-send${p}`;

  it('serves the public key without sign-in', async () => {
    const { h } = setup();
    const res = await h(new Request(url('/config'), { headers: { origin: ORIGIN } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ public_key: 'PUB' });
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    const off = setup({ vapid: false });
    expect(await (await off.h(new Request(url('/config')))).json()).toEqual({ public_key: null });
  });

  it('runs the job only with the database token', async () => {
    const { h, sent } = setup();
    expect((await h(new Request(url(), { method: 'POST' }))).status).toBe(401);
    expect(
      (
        await h(
          new Request(url(), { method: 'POST', headers: { authorization: 'Bearer user-token' } }),
        )
      ).status,
    ).toBe(401);
    const res = await h(
      new Request(url(), { method: 'POST', headers: { authorization: 'Bearer cron-secret' } }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ sent: 1, delivered: 1 });
    expect(sent).toHaveLength(1);
  });

  it('sends a test notification only to the caller’s own subscription', async () => {
    const { h, sent } = setup();
    const post = (body: unknown, auth = 'Bearer user-token') =>
      h(
        new Request(url('/test'), {
          method: 'POST',
          headers: { authorization: auth, origin: ORIGIN },
          body: JSON.stringify(body),
        }),
      );
    expect((await post({ endpoint: sub('u1-phone').endpoint }, 'Bearer nope')).status).toBe(401);
    expect(
      (await post({ endpoint: 'https://fcm.googleapis.com/fcm/send/someone-else' })).status,
    ).toBe(400);
    expect((await post({ endpoint: 'https://evil.example/' })).status).toBe(400);
    const res = await post({ endpoint: sub('u1-phone').endpoint });
    expect(await res.json()).toEqual({ delivered: true, gone: false });
    expect(sent.map((s) => s.message.tag)).toEqual(['engapp-test']);
  });

  it('answers 503 for sends until the keys are set', async () => {
    const { h } = setup({ vapid: false });
    const res = await h(
      new Request(url(), { method: 'POST', headers: { authorization: 'Bearer cron-secret' } }),
    );
    expect(res.status).toBe(503);
  });

  it('reads the VAPID keys from the environment', () => {
    const env = (m: Record<string, string>) => (k: string) => m[k];
    expect(vapidFromEnv(env({}))).toBeNull();
    expect(vapidFromEnv(env({ VAPID_PUBLIC_KEY: 'p', VAPID_PRIVATE_KEY: 'q' }))).toEqual({
      publicKey: 'p',
      privateKey: 'q',
      subject: 'https://engapp-65y.pages.dev',
    });
  });
});
