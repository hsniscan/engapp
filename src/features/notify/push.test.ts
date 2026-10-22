import { beforeEach, describe, expect, it } from 'vitest';
import {
  disablePush,
  dropForeignSubscription,
  enablePush,
  isSubscribedHere,
  keyBytes,
  pushSupport,
  sendTestNotification,
} from './push';
import { fakeBrowser, SERVER_KEY } from './testing';

beforeEach(() => localStorage.clear());

describe('support', () => {
  it('tells what this browser can do', () => {
    expect(pushSupport(fakeBrowser().env)).toBe('supported');
    expect(pushSupport(fakeBrowser({ config: null }).env)).toBe('no_backend');
    const iosTab = fakeBrowser({
      hasPushManager: false,
      notification: null,
      ios: true,
      standalone: false,
    });
    expect(pushSupport(iosTab.env)).toBe('ios_needs_install');
    expect(pushSupport(fakeBrowser({ hasPushManager: false, notification: null }).env)).toBe(
      'unsupported',
    );
    expect(
      pushSupport(fakeBrowser({ hasPushManager: false, ios: true, standalone: true }).env),
    ).toBe('unsupported');
  });
});

describe('enablePush', () => {
  it('asks permission, subscribes with the server key and registers the endpoint', async () => {
    const fb = fakeBrowser();
    expect(await enablePush('user-1', fb.env)).toBe('ok');
    expect(fb.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(SERVER_KEY),
    });
    expect(fb.rpc).toHaveBeenCalledWith('push_subscribe', {
      p_endpoint: 'https://fcm.googleapis.com/fcm/send/device-1',
      p_p256dh: 'P'.repeat(87),
      p_auth: 'A'.repeat(22),
      p_user_agent: fb.env.userAgent,
    });
    // No user id goes to the server: push_subscribe takes the owner from the session.
    expect(JSON.stringify(fb.rpc.mock.calls)).not.toContain('user-1');
    expect(await isSubscribedHere('user-1', fb.env)).toBe(true);
    expect(await isSubscribedHere('user-2', fb.env)).toBe(false);
  });

  it('stops when permission is refused, without subscribing', async () => {
    const fb = fakeBrowser();
    fb.setPermission('default', 'denied');
    expect(await enablePush('user-1', fb.env)).toBe('denied');
    expect(fb.subscribe).not.toHaveBeenCalled();
    expect(fb.rpc).not.toHaveBeenCalled();
  });

  it('reports a backend without keys and a failed registration', async () => {
    expect(await enablePush('u', fakeBrowser({ publicKey: null }).env)).toBe('not_configured');
    const fb = fakeBrowser();
    fb.rpc.mockResolvedValueOnce({ error: { message: 'boom' } });
    expect(await enablePush('u', fb.env)).toBe('error');
    expect(await isSubscribedHere('u', fb.env)).toBe(false);
  });

  it('replaces a subscription made with another server key', async () => {
    const fb = fakeBrowser();
    await enablePush('u', fb.env);
    const other = fakeBrowser({
      publicKey:
        'BMRKPVt9PQw922cSRKRh6QxQcQ4gBrEEeWpHFTh6x7M79lGs9EOdLZYJd3tw3yevah3GdzWeLodes0Po_OXj9Gk',
    });
    other.env.serviceWorker = fb.env.serviceWorker; // same browser, new server key
    other.env.rpc = fb.env.rpc;
    expect(await enablePush('u', other.env)).toBe('ok');
    expect(fb.subscribe).toHaveBeenCalledTimes(2);
    expect(fb.sub?.endpoint).toBe('https://fcm.googleapis.com/fcm/send/device-2');
  });
});

describe('disablePush', () => {
  it('removes the server row and unsubscribes the browser', async () => {
    const fb = fakeBrowser();
    await enablePush('u', fb.env);
    await disablePush(fb.env);
    expect(fb.rpc).toHaveBeenLastCalledWith('push_unsubscribe', {
      p_endpoint: 'https://fcm.googleapis.com/fcm/send/device-1',
    });
    expect(fb.sub).toBeNull();
    expect(await isSubscribedHere('u', fb.env)).toBe(false);
  });

  it('still unsubscribes the browser when offline', async () => {
    const fb = fakeBrowser();
    await enablePush('u', fb.env);
    fb.rpc.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await disablePush(fb.env);
    expect(fb.sub).toBeNull();
  });
});

describe('accounts', () => {
  it('a subscription never carries over to another account or past sign-out', async () => {
    const fb = fakeBrowser();
    await enablePush('user-a', fb.env);
    await dropForeignSubscription('user-a', fb.env);
    expect(fb.sub).not.toBeNull(); // same account: kept
    await dropForeignSubscription('user-b', fb.env);
    expect(fb.sub).toBeNull();
    // The old account's session is gone: only the browser side is undone (the server drops
    // the row on its next send, 410).
    expect(fb.rpc.mock.calls.map((c) => c[0])).toEqual(['push_subscribe']);

    await enablePush('user-a', fb.env);
    await dropForeignSubscription(null, fb.env); // signed out
    expect(fb.sub).toBeNull();
  });
});

describe('test notification', () => {
  it('asks the server for this device with the session token', async () => {
    const fb = fakeBrowser();
    expect(await sendTestNotification(fb.env)).toBe('not_subscribed');
    await enablePush('u', fb.env);
    expect(await sendTestNotification(fb.env)).toBe('sent');
    const [url, init] = fb.fetch.mock.calls.at(-1)! as [string, RequestInit];
    expect(url).toBe('https://proj.supabase.co/functions/v1/push-send/test');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer token-1');
    expect(JSON.parse(init.body as string)).toEqual({
      endpoint: 'https://fcm.googleapis.com/fcm/send/device-1',
    });
  });

  it('reports a gone registration', async () => {
    const fb = fakeBrowser({ testReply: { delivered: false, gone: true } });
    await enablePush('u', fb.env);
    expect(await sendTestNotification(fb.env)).toBe('gone');
  });
});
