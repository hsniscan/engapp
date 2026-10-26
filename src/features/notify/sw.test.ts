// @vitest-environment node
// public/push-sw.js runs inside the generated service worker; here it runs against a fake
// worker global.
import code from '../../../public/push-sw.js?raw';
import { describe, expect, it, vi } from 'vitest';

type Handler = (event: Record<string, unknown>) => void;

function worker(
  clients: { url: string; focus: () => Promise<unknown>; postMessage: (m: unknown) => void }[] = [],
) {
  const handlers = new Map<string, Handler>();
  const sw = {
    location: new URL('https://engapp.example/sw.js'),
    addEventListener: (type: string, h: Handler) => handlers.set(type, h),
    registration: { showNotification: vi.fn(async () => {}) },
    clients: { matchAll: vi.fn(async () => clients), openWindow: vi.fn(async () => null) },
  };
  new Function('self', code)(sw);
  const fire = async (type: string, event: Record<string, unknown>) => {
    let wait: Promise<unknown> = Promise.resolve();
    handlers.get(type)!({ ...event, waitUntil: (p: Promise<unknown>) => (wait = p) });
    await wait;
  };
  return { sw, fire, handlers };
}

const pushEvent = (payload: unknown) => ({
  data: {
    json: () => (typeof payload === 'string' ? JSON.parse(payload) : payload),
    text: () => String(payload),
  },
});

describe('push service worker', () => {
  it('registers push and notificationclick handlers', () => {
    expect([...worker().handlers.keys()].sort()).toEqual(['notificationclick', 'push']);
  });

  it('shows the server text with the reminder tag', async () => {
    const { sw, fire } = worker();
    await fire(
      'push',
      pushEvent({
        title: 'Engapp',
        body: 'Bugün 23 kart tekrara hazır, yaklaşık 6 dk.',
        url: '/review',
        tag: 'engapp-due',
      }),
    );
    expect(sw.registration.showNotification).toHaveBeenCalledWith('Engapp', {
      body: 'Bugün 23 kart tekrara hazır, yaklaşık 6 dk.',
      tag: 'engapp-due',
      lang: 'tr',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: '/review' },
    });
  });

  it('survives a payload that is not JSON and never links off-site', async () => {
    const { sw, fire } = worker();
    await fire('push', pushEvent('not json'));
    await fire('push', pushEvent({ body: 'x', url: 'https://evil.example/' }));
    await fire('push', pushEvent({ url: '//evil.example/' }));
    const calls = sw.registration.showNotification.mock.calls as unknown as [
      string,
      { body: string; data: { url: string } },
    ][];
    expect(calls.map((c) => [c[0], c[1].data.url])).toEqual([
      ['Engapp', '/review'],
      ['Engapp', '/review'],
      ['Engapp', '/review'],
    ]);
    expect(calls[0]![1].body).toBe('not json');
  });

  it('a tap opens /review in a new window when the app is closed', async () => {
    const { sw, fire } = worker();
    const close = vi.fn();
    await fire('notificationclick', { notification: { close, data: { url: '/review' } } });
    expect(close).toHaveBeenCalled();
    expect(sw.clients.openWindow).toHaveBeenCalledWith('/review');
  });

  it('a tap focuses the open app and routes it in place', async () => {
    const focus = vi.fn(async () => null);
    const postMessage = vi.fn();
    const { sw, fire } = worker([
      { url: 'https://other.example/', focus: vi.fn(async () => null), postMessage: vi.fn() },
      { url: 'https://engapp.example/library', focus, postMessage },
    ]);
    await fire('notificationclick', {
      notification: { close: () => {}, data: { url: '/review' } },
    });
    expect(postMessage).toHaveBeenCalledWith({ type: 'engapp:navigate', url: '/review' });
    expect(focus).toHaveBeenCalled();
    expect(sw.clients.openWindow).not.toHaveBeenCalled();
  });
});
