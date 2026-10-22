// Web Push sender (v0.3 İP8): VAPID (RFC 8292) and message encryption (RFC 8291,
// aes128gcm, RFC 8188) on Web Crypto only, so it runs unchanged in Deno (edge function) and
// in Node (vitest). No library: the protocol is two HKDF steps, one ECDH, one AES-GCM and one
// ES256 signature, and a dependency would add more code than it saves (docs/decisions/0024).

export type Bytes = Uint8Array<ArrayBuffer>;

const enc = new TextEncoder();

export function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(s: string): Bytes {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Bytes> {
  const k = await crypto.subtle.importKey(
    'raw',
    concat(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, concat(data)));
}

/** HKDF-SHA-256 with an output of at most 32 bytes (one block, as Web Push needs). */
async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Bytes> {
  const prk = await hmac(salt, ikm);
  return (await hmac(prk, concat(info, new Uint8Array([1])))).slice(0, length);
}

// ------------------------------------------------------------------ subscriptions

export interface PushTarget {
  endpoint: string;
  /** Browser's P-256 public key, base64url (65 bytes uncompressed). */
  p256dh: string;
  /** Browser's auth secret, base64url (16 bytes). */
  auth: string;
}

/**
 * Push services of the browsers Engapp supports. The server only ever posts to these
 * hosts, so a forged subscription cannot make it call an arbitrary URL.
 */
const PUSH_HOSTS: RegExp[] = [
  /^fcm\.googleapis\.com$/, // Chrome, Edge (Chromium), Samsung Internet, Opera
  /^android\.googleapis\.com$/,
  /^([a-z0-9-]+\.)*push\.services\.mozilla\.com$/, // Firefox
  /^([a-z0-9-]+\.)*push\.apple\.com$/, // Safari (macOS, iOS 16.4+ installed web apps)
  /^([a-z0-9-]+\.)*notify\.windows\.com$/, // Edge (WNS)
];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.port !== '' || u.username || u.password) return false;
  return endpoint.length <= 1024 && PUSH_HOSTS.some((re) => re.test(u.hostname));
}

export function isValidTarget(t: PushTarget): boolean {
  try {
    return (
      isAllowedPushEndpoint(t.endpoint) &&
      b64urlDecode(t.p256dh).length === 65 &&
      b64urlDecode(t.p256dh)[0] === 4 &&
      b64urlDecode(t.auth).length === 16
    );
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ VAPID (RFC 8292)

export interface VapidKeys {
  /** Uncompressed P-256 public key, base64url (65 bytes). Also the client's applicationServerKey. */
  publicKey: string;
  /** P-256 private scalar d, base64url (32 bytes). */
  privateKey: string;
  /** Contact for the push services: mailto: or https: URL. */
  subject: string;
}

async function importVapidKey(keys: VapidKeys): Promise<CryptoKey> {
  const pub = b64urlDecode(keys.publicKey);
  if (pub.length !== 65 || pub[0] !== 4)
    throw new Error('VAPID public key must be an uncompressed P-256 point');
  return crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      x: b64urlEncode(pub.slice(1, 33)),
      y: b64urlEncode(pub.slice(33, 65)),
      d: keys.privateKey,
      ext: true,
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
}

/** `Authorization` header value for a push to `endpoint` (JWT valid for 12 hours). */
export async function vapidAuthorization(
  endpoint: string,
  keys: VapidKeys,
  nowMs: number,
): Promise<string> {
  const aud = new URL(endpoint).origin;
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64urlEncode(
    enc.encode(
      JSON.stringify({ aud, exp: Math.floor(nowMs / 1000) + 12 * 3600, sub: keys.subject }),
    ),
  );
  const key = await importVapidKey(keys);
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      enc.encode(`${header}.${claims}`),
    ),
  );
  return `vapid t=${header}.${claims}.${b64urlEncode(sig)}, k=${keys.publicKey}`;
}

// ------------------------------------------------------------------ encryption (RFC 8291)

const RECORD_SIZE = 4096;

export interface EncryptOptions {
  /** For tests: fixed salt (16 bytes) and sender key pair. */
  salt?: Bytes;
  senderKeys?: CryptoKeyPair;
}

/** Encrypts `plaintext` for one subscription: the aes128gcm body of the push request. */
export async function encryptPayload(
  target: PushTarget,
  plaintext: Uint8Array,
  opts: EncryptOptions = {},
): Promise<Bytes> {
  const uaPublic = b64urlDecode(target.p256dh);
  const authSecret = b64urlDecode(target.auth);
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const sender =
    opts.senderKeys ??
    ((await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
      'deriveBits',
    ])) as CryptoKeyPair);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', sender.publicKey));
  const uaKey = await crypto.subtle.importKey(
    'raw',
    uaPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, sender.privateKey, 256),
  );

  // RFC 8291 §3.4: IKM from the auth secret and both public keys, then CEK and nonce (RFC 8188).
  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  // One record: the plaintext followed by the last-record delimiter 0x02 (no padding).
  if (plaintext.length + 1 + 16 > RECORD_SIZE) throw new Error('Push payload too large');
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce },
      aes,
      concat(plaintext, new Uint8Array([2])),
    ),
  );
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, RECORD_SIZE);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

// ------------------------------------------------------------------ sending

export type SendOutcome =
  /** Accepted by the push service. */
  | { kind: 'ok'; status: number }
  /** The subscription no longer exists (404/410): delete it. */
  | { kind: 'gone'; status: number }
  /** Any other failure; the subscription is kept. */
  | { kind: 'failed'; status: number | null; detail: string };

export interface SendOptions {
  fetch?: typeof fetch;
  now?: number;
  /** Seconds the push service keeps an undelivered message (default 4 hours). */
  ttl?: number;
  urgency?: 'very-low' | 'low' | 'normal' | 'high';
  /** Replaces an undelivered message with the same topic. */
  topic?: string;
}

export async function sendWebPush(
  target: PushTarget,
  payload: unknown,
  keys: VapidKeys,
  opts: SendOptions = {},
): Promise<SendOutcome> {
  if (!isValidTarget(target)) return { kind: 'gone', status: 0 };
  const doFetch = opts.fetch ?? fetch;
  try {
    const body = await encryptPayload(target, enc.encode(JSON.stringify(payload)));
    const headers: Record<string, string> = {
      Authorization: await vapidAuthorization(target.endpoint, keys, opts.now ?? Date.now()),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(opts.ttl ?? 4 * 3600),
      Urgency: opts.urgency ?? 'normal',
    };
    if (opts.topic) headers.Topic = opts.topic;
    const res = await doFetch(target.endpoint, {
      method: 'POST',
      headers,
      body,
      redirect: 'manual',
    });
    if (res.status >= 200 && res.status < 300) return { kind: 'ok', status: res.status };
    if (res.status === 404 || res.status === 410) return { kind: 'gone', status: res.status };
    const text = await res.text().catch(() => '');
    return { kind: 'failed', status: res.status, detail: text.slice(0, 200) };
  } catch (e) {
    return { kind: 'failed', status: null, detail: e instanceof Error ? e.message : String(e) };
  }
}
