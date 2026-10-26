// Cloudflare R2 through its S3-compatible API, with our own thin AWS Signature Version 4
// (docs/decisions/0053-audio-r2-maintenance.md). No SDK: Web Crypto and fetch only, so the same
// file runs in the Deno edge functions, in the Node scripts and in vitest. Used for the shared
// pronunciation audio (`<voice>/<hash>.mp3`), which the app plays from the bucket's public URL.
//
// Only what the audio needs: HEAD, PUT, DELETE of one object and ListObjectsV2. Path-style
// requests to https://<account>.r2.cloudflarestorage.com/<bucket>/<key>, region "auto".

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Override for tests; default https://<accountId>.r2.cloudflarestorage.com */
  endpoint?: string;
}

/**
 * The R2 credentials from the environment, or null unless all four are set (then every
 * caller stays on Supabase Storage exactly as before).
 */
export function r2ConfigFromEnv(env: (k: string) => string | undefined): R2Config | null {
  const accountId = env('R2_ACCOUNT_ID')?.trim();
  const accessKeyId = env('R2_ACCESS_KEY_ID')?.trim();
  const secretAccessKey = env('R2_SECRET_ACCESS_KEY')?.trim();
  const bucket = env('R2_BUCKET')?.trim();
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket };
}

// ------------------------------------------------------------------ Signature Version 4

const enc = new TextEncoder();

function hex(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
}

function toBytes(data: string | Uint8Array): Uint8Array<ArrayBuffer> {
  if (typeof data === 'string') return enc.encode(data);
  const out = new Uint8Array(data.byteLength);
  out.set(data);
  return out;
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', toBytes(data)));
}

async function hmac(key: Uint8Array, data: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey(
    'raw',
    toBytes(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(data)));
}

/** RFC 3986 encoding as SigV4 wants it (unreserved: A-Z a-z 0-9 - _ . ~). */
export function uriEncode(s: string, keepSlash = false): string {
  let out = '';
  for (const ch of s) {
    if (/^[A-Za-z0-9\-_.~]$/.test(ch) || (keepSlash && ch === '/')) out += ch;
    else for (const b of enc.encode(ch)) out += `%${b.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

/** 20130524T000000Z */
export function amzDate(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

/** SHA-256 of an empty body (GET, HEAD, DELETE). */
export const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

export interface SignInput {
  method: string;
  url: URL;
  /** Headers to sign besides host, x-amz-date and x-amz-content-sha256. */
  headers?: Record<string, string>;
  payloadHash: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
  now: Date;
}

/**
 * Signs a request (AWS Signature Version 4, header form). Returns every header to send,
 * `authorization` included. The URL's path must already be encoded the way it is sent.
 */
export async function signV4(input: SignInput): Promise<Record<string, string>> {
  const date = amzDate(input.now);
  const day = date.slice(0, 8);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.headers ?? {})) headers[k.toLowerCase()] = v;
  headers['host'] = input.url.host;
  headers['x-amz-date'] = date;
  headers['x-amz-content-sha256'] = input.payloadHash;

  const names = Object.keys(headers).sort();
  const canonicalHeaders = names
    .map((n) => `${n}:${headers[n]!.trim().replace(/\s+/g, ' ')}\n`)
    .join('');
  const signedHeaders = names.join(';');
  const query = [...input.url.searchParams.entries()]
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const canonicalRequest = [
    input.method.toUpperCase(),
    input.url.pathname || '/',
    query,
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join('\n');

  const scope = `${day}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', date, scope, await sha256Hex(canonicalRequest)].join(
    '\n',
  );

  let key = await hmac(enc.encode(`AWS4${input.secretAccessKey}`), day);
  key = await hmac(key, input.region);
  key = await hmac(key, input.service);
  key = await hmac(key, 'aws4_request');
  const signature = hex(await hmac(key, stringToSign));

  return {
    ...headers,
    authorization:
      `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

// ------------------------------------------------------------------ client

export class R2Error extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'R2Error';
    this.status = status;
  }
}

export interface R2Object {
  key: string;
  size: number;
}

export interface R2ClientOptions {
  fetch?: typeof fetch;
  now?: () => Date;
  /** Per-request timeout in ms (default 15 s). */
  timeoutMs?: number;
}

function xmlText(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

/** The objects, truncation flag and next token of a ListObjectsV2 answer. */
export function parseListObjectsV2(xml: string): {
  objects: R2Object[];
  truncated: boolean;
  next: string | null;
} {
  const objects: R2Object[] = [];
  for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const body = m[1]!;
    const key = /<Key>([\s\S]*?)<\/Key>/.exec(body)?.[1];
    const size = /<Size>(\d+)<\/Size>/.exec(body)?.[1];
    if (key !== undefined) objects.push({ key: xmlText(key), size: Number(size ?? 0) });
  }
  const truncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(xml);
  const next = /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1];
  return { objects, truncated, next: next !== undefined ? xmlText(next) : null };
}

export class R2Client {
  readonly bucket: string;
  private readonly cfg: R2Config;
  private readonly endpoint: string;
  private readonly doFetch: typeof fetch;
  private readonly now: () => Date;
  private readonly timeoutMs: number;

  constructor(cfg: R2Config, opts: R2ClientOptions = {}) {
    this.cfg = cfg;
    this.bucket = cfg.bucket;
    this.endpoint = (cfg.endpoint ?? `https://${cfg.accountId}.r2.cloudflarestorage.com`).replace(
      /\/+$/,
      '',
    );
    this.doFetch = opts.fetch ?? ((...a) => fetch(...a));
    this.now = opts.now ?? (() => new Date());
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  /** https://<account>.r2.cloudflarestorage.com/<bucket>/<encoded key> */
  objectUrl(key: string): URL {
    return new URL(`${this.endpoint}/${uriEncode(this.bucket)}/${uriEncode(key, true)}`);
  }

  private async send(
    method: string,
    url: URL,
    body?: Uint8Array,
    headers: Record<string, string> = {},
  ): Promise<Response> {
    const payloadHash = body ? await sha256Hex(body) : EMPTY_SHA256;
    const signed = await signV4({
      method,
      url,
      headers,
      payloadHash,
      accessKeyId: this.cfg.accessKeyId,
      secretAccessKey: this.cfg.secretAccessKey,
      region: 'auto',
      service: 's3',
      now: this.now(),
    });
    // `host` is set by fetch itself (a forbidden header name in browsers).
    const { host: _host, ...send } = signed;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      return await this.doFetch(url.toString(), {
        method,
        headers: send,
        body: body ? toBytes(body) : undefined,
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /** The object's size, or null when it does not exist. Throws on other errors. */
  async head(key: string): Promise<{ size: number } | null> {
    const r = await this.send('HEAD', this.objectUrl(key));
    await r.body?.cancel();
    if (r.status === 404) return null;
    if (!r.ok) throw new R2Error(`HEAD ${key}: HTTP ${r.status}`, r.status);
    return { size: Number(r.headers.get('content-length') ?? 0) };
  }

  /** Stores an object (overwrites). Throws on any non-2xx answer. */
  async put(
    key: string,
    body: Uint8Array,
    opts: { contentType: string; cacheControl?: string },
  ): Promise<void> {
    const headers: Record<string, string> = { 'content-type': opts.contentType };
    if (opts.cacheControl) headers['cache-control'] = opts.cacheControl;
    const r = await this.send('PUT', this.objectUrl(key), body, headers);
    const text = r.ok ? '' : await r.text().catch(() => '');
    if (!r.ok) {
      const code = /<Code>([^<]*)<\/Code>/.exec(text)?.[1];
      throw new R2Error(`PUT ${key}: HTTP ${r.status}${code ? ` ${code}` : ''}`, r.status);
    }
    await r.body?.cancel();
  }

  /** Deletes an object; a missing object is not an error. */
  async delete(key: string): Promise<void> {
    const r = await this.send('DELETE', this.objectUrl(key));
    await r.body?.cancel();
    if (!r.ok && r.status !== 404) throw new R2Error(`DELETE ${key}: HTTP ${r.status}`, r.status);
  }

  /** Every object under a prefix (ListObjectsV2, 1000 per page). */
  async list(prefix: string): Promise<R2Object[]> {
    const out: R2Object[] = [];
    let token: string | null = null;
    for (let page = 0; page < 100_000; page++) {
      const url = new URL(`${this.endpoint}/${uriEncode(this.bucket)}`);
      url.searchParams.set('list-type', '2');
      url.searchParams.set('max-keys', '1000');
      if (prefix) url.searchParams.set('prefix', prefix);
      if (token) url.searchParams.set('continuation-token', token);
      // URLSearchParams writes spaces as '+'; S3 wants %20 in the request too.
      url.search = url.search.replace(/\+/g, '%20');
      const r = await this.send('GET', url);
      const xml = await r.text();
      if (!r.ok) throw new R2Error(`LIST ${prefix}: HTTP ${r.status}`, r.status);
      const p = parseListObjectsV2(xml);
      out.push(...p.objects);
      if (!p.truncated || !p.next) break;
      token = p.next;
    }
    return out;
  }
}
