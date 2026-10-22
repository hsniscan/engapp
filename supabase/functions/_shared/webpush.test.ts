// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  b64urlDecode,
  b64urlEncode,
  encryptPayload,
  isAllowedPushEndpoint,
  isValidTarget,
  sendWebPush,
  vapidAuthorization,
  type VapidKeys,
} from './webpush.ts';

// Known-answer vector made once with http_ece 1.2.1 (the reference implementation of RFC 8188
// / RFC 8291 by the RFCs' author): receiver and sender keys, auth secret and salt fixed.
// Throwaway keys, used nowhere else.
const V = {
  ua_public:
    'BDNPg_bUc1DAJOXR5gtmV5Mnk6pglLbL_f-fEaxuVth-fHx6gNPY6xM9Kyk3fGzqiWUDN5volRVJdUUfEidwNkA',
  as_public:
    'BMRKPVt9PQw922cSRKRh6QxQcQ4gBrEEeWpHFTh6x7M79lGs9EOdLZYJd3tw3yevah3GdzWeLodes0Po_OXj9Gk',
  as_private: 'XmRB7lRCWUn76pafNnQPvlE9d1uRegn3VYWgYHV6E0I',
  auth: 'zAx9h6dlXE_PR3bf_Lfo1Q',
  salt: 'sOBdz3F7Ki0L77GVCGnY5g',
  plaintext: '{"title":"Engapp","body":"Bugün 23 tekrar seni bekliyor (~6 dk)"}',
  body: 'sOBdz3F7Ki0L77GVCGnY5gAAEABBBMRKPVt9PQw922cSRKRh6QxQcQ4gBrEEeWpHFTh6x7M79lGs9EOdLZYJd3tw3yevah3GdzWeLodes0Po_OXj9Gl6GDtdPPI7aZEe6zJPm5J-8anILxA6Vadzy5pxWSPxfzDL8H129JzERUMEtIRhIVfzHl219EES1YMGFzzs1Xmw3IvZAz9MH_qaEq4Fvw90gxLfZA',
};

async function senderKeys(): Promise<CryptoKeyPair> {
  const pub = b64urlDecode(V.as_public);
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    x: b64urlEncode(pub.slice(1, 33)),
    y: b64urlEncode(pub.slice(33)),
  };
  return {
    publicKey: await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      [],
    ),
    privateKey: await crypto.subtle.importKey(
      'jwk',
      { ...jwk, d: V.as_private },
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveBits'],
    ),
  };
}

const target = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc:def',
  p256dh: V.ua_public,
  auth: V.auth,
};

async function vapidKeys(): Promise<VapidKeys> {
  const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  return { publicKey: b64urlEncode(raw), privateKey: jwk.d!, subject: 'https://engapp.example' };
}

describe('aes128gcm encryption (RFC 8291)', () => {
  it('matches the reference implementation byte for byte', async () => {
    const out = await encryptPayload(target, new TextEncoder().encode(V.plaintext), {
      salt: b64urlDecode(V.salt),
      senderKeys: await senderKeys(),
    });
    expect(b64urlEncode(out)).toBe(V.body);
  });

  it('uses a fresh salt and key for every message', async () => {
    const a = await encryptPayload(target, new TextEncoder().encode('x'));
    const b = await encryptPayload(target, new TextEncoder().encode('x'));
    expect(b64urlEncode(a)).not.toBe(b64urlEncode(b));
    expect(a.length).toBe(16 + 4 + 1 + 65 + 1 + 1 + 16);
  });
});

describe('VAPID (RFC 8292)', () => {
  it('signs a JWT for the push service origin that verifies with the public key', async () => {
    const keys = await vapidKeys();
    const now = Date.UTC(2026, 9, 23, 16);
    const h = await vapidAuthorization(target.endpoint, keys, now);
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h)!;
    expect(m[4]).toBe(keys.publicKey);
    const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(m[2]!)));
    expect(claims).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: now / 1000 + 12 * 3600,
      sub: 'https://engapp.example',
    });
    const pub = await crypto.subtle.importKey(
      'raw',
      b64urlDecode(keys.publicKey),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      pub,
      b64urlDecode(m[3]!),
      new TextEncoder().encode(`${m[1]}.${m[2]}`),
    );
    expect(ok).toBe(true);
  });
});

describe('endpoints', () => {
  it('accepts only the browsers’ push services over https', () => {
    for (const ok of [
      'https://fcm.googleapis.com/fcm/send/x',
      'https://updates.push.services.mozilla.com/wpush/v2/x',
      'https://web.push.apple.com/QK',
      'https://wns2-par02p.notify.windows.com/w/?token=x',
    ])
      expect(isAllowedPushEndpoint(ok), ok).toBe(true);
    for (const bad of [
      'http://fcm.googleapis.com/fcm/send/x',
      'https://fcm.googleapis.com:8443/x',
      'https://fcm.googleapis.com.evil.example/x',
      'https://evil.example/fcm.googleapis.com',
      'https://user:pw@fcm.googleapis.com/x',
      'https://169.254.169.254/latest',
      'not a url',
    ])
      expect(isAllowedPushEndpoint(bad), bad).toBe(false);
    expect(isValidTarget(target)).toBe(true);
    expect(isValidTarget({ ...target, auth: 'short' })).toBe(false);
  });
});

describe('sendWebPush', () => {
  it('posts the encrypted body with the protocol headers', async () => {
    const keys = await vapidKeys();
    let seen: { url: string; init: RequestInit } | null = null;
    const fetchStub = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;
    const out = await sendWebPush(target, { title: 'Engapp' }, keys, {
      fetch: fetchStub,
      ttl: 60,
      topic: 'engapp-due',
    });
    expect(out).toEqual({ kind: 'ok', status: 201 });
    const h = seen!.init.headers as Record<string, string>;
    expect(seen!.url).toBe(target.endpoint);
    expect(h['Content-Encoding']).toBe('aes128gcm');
    expect(h.TTL).toBe('60');
    expect(h.Topic).toBe('engapp-due');
    expect(h.Authorization).toMatch(/^vapid t=.+, k=/);
  });

  it('classifies gone and failed subscriptions', async () => {
    const keys = await vapidKeys();
    const reply = (status: number) =>
      (async () => new Response('nope', { status })) as unknown as typeof fetch;
    expect((await sendWebPush(target, {}, keys, { fetch: reply(410) })).kind).toBe('gone');
    expect((await sendWebPush(target, {}, keys, { fetch: reply(404) })).kind).toBe('gone');
    expect(await sendWebPush(target, {}, keys, { fetch: reply(429) })).toEqual({
      kind: 'failed',
      status: 429,
      detail: 'nope',
    });
    const boom = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await sendWebPush(target, {}, keys, { fetch: boom })).toEqual({
      kind: 'failed',
      status: null,
      detail: 'offline',
    });
    // A stored row that is not a push service is never called.
    expect(
      (
        await sendWebPush({ ...target, endpoint: 'https://evil.example/' }, {}, keys, {
          fetch: reply(201),
        })
      ).kind,
    ).toBe('gone');
  });
});
