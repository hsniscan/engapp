// fetch-article (v0.5 İP2, decision 0044): fetches one web page for a signed-in user and
// returns its article as plain text. Environment-neutral: DNS, fetch and the clock are
// injected (Deno in production, fakes in the tests). Nothing about the page is stored; only
// the user's daily counter is.
//
// Every hop is checked before it is fetched (net-guard.ts): http(s) on a default port, no
// credentials, a host whose every address is public. Redirects are followed by hand, at most
// MAX_REDIRECTS, each re-checked. robots.txt is honoured for EngappReader on the origin of
// every page hop. One 10 s deadline covers the whole request; bodies stop at 2 MB.

import {
  articleRequest,
  DEFAULT_ARTICLE_DAILY_LIMIT,
  type ArticleResponse,
} from './article-contract.ts';
import { extractArticle } from './article-extract.ts';
import { ApiError } from './errors.ts';
import { BlockedUrlError, checkUrl, checkUrlShape, type Resolver } from './net-guard.ts';
import { robotsAllows } from './robots.ts';

export const ARTICLE_USER_AGENT = 'EngappReader/1.0 (+https://engapp-65y.pages.dev/gizlilik)';
export const MAX_REDIRECTS = 3;
export const ARTICLE_TIMEOUT_MS = 10_000;
export const MAX_PAGE_BYTES = 2 * 1024 * 1024;
export const MAX_ROBOTS_BYTES = 512 * 1024;

export interface ArticleStore {
  /** Takes one fetch from the user's daily budget (atomic). */
  consume(
    userId: string,
    limit: number,
  ): Promise<{ allowed: boolean; used: number; limit: number }>;
}

export interface ArticleDeps {
  userId: string;
  store: ArticleStore;
  resolve: Resolver;
  fetch: typeof fetch;
  dailyLimit: number;
  /** Deadline for the whole request; default ARTICLE_TIMEOUT_MS. */
  timeoutMs?: number;
  log?: (msg: string, data?: Record<string, unknown>) => void;
}

export function articleDailyLimit(env: (k: string) => string | undefined): number {
  const n = Number(env('ARTICLE_DAILY_LIMIT'));
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_ARTICLE_DAILY_LIMIT;
}

const REDIRECT = new Set([301, 302, 303, 307, 308]);

interface Fetched {
  url: URL;
  status: number;
  contentType: string;
  bytes: Uint8Array;
}

class TooLarge extends Error {}

async function readCapped(res: Response, max: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel().catch(() => {});
    throw new TooLarge(`content-length ${declared}`);
  }
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      throw new TooLarge(`body over ${max} bytes`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

interface Ctx {
  deps: ArticleDeps;
  signal: AbortSignal;
  robots: Map<string, Promise<string | null | 'unreachable'>>;
}

/**
 * GET with manual redirects; every hop passes checkUrl, and `beforeHop` (robots) when given.
 * Throws BlockedUrlError, TooLarge, or ApiError('fetch_failed').
 */
async function guardedGet(
  ctx: Ctx,
  start: string,
  opts: { accept: string; maxBytes: number; beforeHop?: (u: URL) => Promise<void> },
): Promise<Fetched> {
  let current = start;
  for (let hop = 0; ; hop++) {
    const url = await checkUrl(current, ctx.deps.resolve);
    if (opts.beforeHop) await opts.beforeHop(url);
    let res: Response;
    try {
      res = await ctx.deps.fetch(url.href, {
        method: 'GET',
        redirect: 'manual',
        signal: ctx.signal,
        headers: {
          'user-agent': ARTICLE_USER_AGENT,
          accept: opts.accept,
          'accept-language': 'en;q=1, *;q=0.5',
        },
      });
    } catch (e) {
      const why = ctx.signal.aborted ? 'timeout' : `network: ${String(e)}`;
      throw new ApiError('fetch_failed', `The site did not answer (${why}).`);
    }
    if (REDIRECT.has(res.status)) {
      const loc = res.headers.get('location');
      await res.body?.cancel().catch(() => {});
      if (!loc) throw new ApiError('fetch_failed', `Redirect ${res.status} without a location.`);
      if (hop >= MAX_REDIRECTS) throw new ApiError('fetch_failed', 'Too many redirects.');
      current = new URL(loc, url).href;
      continue;
    }
    const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
    let bytes: Uint8Array;
    try {
      bytes = await readCapped(res, opts.maxBytes);
    } catch (e) {
      if (e instanceof TooLarge) throw e;
      const why = ctx.signal.aborted ? 'timeout' : `read: ${String(e)}`;
      throw new ApiError('fetch_failed', `The page could not be read (${why}).`);
    }
    return { url, status: res.status, contentType, bytes };
  }
}

/** robots.txt of an origin: its text, null (none: allow all) or 'unreachable' (RFC 9309: disallow). */
function robotsFor(ctx: Ctx, origin: string): Promise<string | null | 'unreachable'> {
  let p = ctx.robots.get(origin);
  if (!p) {
    p = guardedGet(ctx, `${origin}/robots.txt`, {
      accept: 'text/plain',
      maxBytes: MAX_ROBOTS_BYTES,
    }).then(
      (r) => {
        if (r.status >= 200 && r.status < 300) return new TextDecoder().decode(r.bytes);
        if (r.status >= 400 && r.status < 500) return null;
        return 'unreachable' as const;
      },
      // Network error, timeout, a redirect to a blocked address, or an oversized file.
      () => 'unreachable' as const,
    );
    ctx.robots.set(origin, p);
  }
  return p;
}

async function checkRobots(ctx: Ctx, url: URL): Promise<void> {
  const robots = await robotsFor(ctx, url.origin);
  if (ctx.signal.aborted) throw new ApiError('fetch_failed', 'The site did not answer (timeout).');
  if (robots === null) return;
  if (robots === 'unreachable' || !robotsAllows(robots, url.pathname + url.search)) {
    throw new ApiError('robots_disallowed', 'The site does not allow this page to be fetched.');
  }
}

/** Charset from the Content-Type header, else from <meta charset> in the first 2 KB. */
export function detectCharset(contentType: string, bytes: Uint8Array): string {
  const fromHeader = /charset=["']?([\w.:-]+)/i.exec(contentType)?.[1];
  if (fromHeader) return fromHeader;
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 2048));
  const meta =
    /<meta[^>]+charset=["']?([\w.:-]+)/i.exec(head)?.[1] ??
    /<meta[^>]+content=["'][^"']*charset=([\w.:-]+)/i.exec(head)?.[1];
  return meta ?? 'utf-8';
}

/** 0x80–0x9F of windows-1252 (the rest is Latin-1). */
const CP1252_HIGH =
  '\u20ac\ufffd\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\ufffd\u017d\ufffd' +
  '\ufffd\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\ufffd\u017e\u0178';

/** The labels WHATWG Encoding maps to windows-1252. */
const CP1252_LABELS = new Set([
  'windows-1252',
  'cp1252',
  'x-cp1252',
  'latin1',
  'l1',
  'iso-8859-1',
  'iso8859-1',
  'iso_8859-1',
  'iso88591',
  'us-ascii',
  'ascii',
  'ansi_x3.4-1968',
  'cp819',
  'ibm819',
  'iso-ir-100',
]);

/**
 * windows-1252 by hand: runtimes built without full ICU (Node small-icu) decode it as
 * Latin-1, which turns curly quotes and dashes into control characters.
 */
function decodeCp1252(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    const part = bytes.subarray(i, i + 8192);
    out += String.fromCharCode(
      ...Array.from(part, (b) => (b >= 0x80 && b <= 0x9f ? CP1252_HIGH.charCodeAt(b - 0x80) : b)),
    );
  }
  return out;
}

export function decodeHtml(contentType: string, bytes: Uint8Array): string {
  const charset = detectCharset(contentType, bytes);
  if (CP1252_LABELS.has(charset.toLowerCase())) return decodeCp1252(bytes);
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

export async function runFetchArticle(body: unknown, deps: ArticleDeps): Promise<ArticleResponse> {
  const parsed = articleRequest.safeParse(body);
  if (!parsed.success) throw new ApiError('invalid_input', 'Invalid fetch-article request');
  const raw = parsed.data.url;

  // Refuse a bad address before it costs one of the day's fetches.
  try {
    checkUrlShape(raw); // DNS is checked per hop below
  } catch (e) {
    if (e instanceof BlockedUrlError)
      throw new ApiError('blocked_url', 'This address cannot be fetched.');
    throw e;
  }

  const usage = await deps.store.consume(deps.userId, deps.dailyLimit);
  if (!usage.allowed) {
    throw new ApiError(
      'daily_limit',
      `Daily article limit reached (${usage.used}/${usage.limit}).`,
    );
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), deps.timeoutMs ?? ARTICLE_TIMEOUT_MS);
  const ctx: Ctx = { deps, signal: ctrl.signal, robots: new Map() };
  const started = Date.now();
  try {
    let page: Fetched;
    try {
      page = await guardedGet(ctx, raw, {
        accept: 'text/html,application/xhtml+xml;q=0.9',
        maxBytes: MAX_PAGE_BYTES,
        beforeHop: (u) => checkRobots(ctx, u),
      });
    } catch (e) {
      if (e instanceof BlockedUrlError) {
        deps.log?.('blocked', { reason: e.message });
        throw new ApiError('blocked_url', 'This address cannot be fetched.');
      }
      if (e instanceof TooLarge) throw new ApiError('too_large', 'The page is larger than 2 MB.');
      throw e;
    }
    // 401 / 402: a login or payment wall. (403 is mostly bot protection: fetch_failed below.)
    if (page.status === 401 || page.status === 402) {
      throw new ApiError('paywalled', `The site refused the page (HTTP ${page.status}).`);
    }
    if (page.status < 200 || page.status >= 300) {
      throw new ApiError('fetch_failed', `The site answered HTTP ${page.status}.`);
    }
    const mime = page.contentType.split(';')[0]!.trim();
    if (mime !== 'text/html') throw new ApiError('not_html', 'The address is not a web page.');

    const html = decodeHtml(page.contentType, page.bytes);
    const out = extractArticle(html, page.url.href);
    // Log sizes and timing only: never the address or the text (they are the user's).
    deps.log?.('extracted', {
      ok: out.ok,
      bytes: page.bytes.byteLength,
      ms: Date.now() - started,
      ...(out.ok ? { paragraphs: out.article.paragraphs.length } : { reason: out.reason }),
    });
    if (!out.ok) {
      throw new ApiError(
        out.reason,
        out.reason === 'paywalled'
          ? 'The page is for subscribers only.'
          : 'No readable article text was found on the page.',
      );
    }
    return {
      url: page.url.href,
      ...out.article,
      usage: { used: usage.used, limit: usage.limit },
    };
  } finally {
    clearTimeout(timer);
  }
}
