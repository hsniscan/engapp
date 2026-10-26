// @vitest-environment node
// fetch-article (decision 0044): SSRF guard, robots.txt, limits and the Readability fixtures.
// No live network: DNS and fetch are fakes; the fixtures are saved pages with invented text.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { articleResponse } from './article-contract.ts';
import { extractArticle } from './article-extract.ts';
import {
  ARTICLE_USER_AGENT,
  decodeHtml,
  MAX_PAGE_BYTES,
  runFetchArticle,
  type ArticleDeps,
} from './article.ts';
import { ApiError } from './errors.ts';
import { blockedAddress, checkUrl, checkUrlShape, parseIPv6, type Resolver } from './net-guard.ts';
import { robotsAllows } from './robots.ts';

const FIXTURES = new URL('./testing/article-fixtures/', import.meta.url);
const fixture = (name: string) => new Uint8Array(readFileSync(new URL(name, FIXTURES)));
const fixtureText = (name: string) => decodeHtml('text/html', fixture(name));

// ------------------------------------------------------------------ addresses

describe('blockedAddress', () => {
  it.each([
    ['127.0.0.1', 'loopback'],
    ['10.1.2.3', 'private'],
    ['172.31.255.255', 'private'],
    ['192.168.0.10', 'private'],
    ['169.254.169.254', 'link-local'], // cloud metadata
    ['100.64.0.1', 'carrier-grade NAT'],
    ['100.127.255.254', 'carrier-grade NAT'],
    ['0.0.0.0', 'this network'],
    ['224.0.0.251', 'multicast'],
    ['255.255.255.255', 'reserved / broadcast'],
    ['198.18.0.1', 'benchmarking'],
    ['::1', 'loopback'],
    ['::', 'unspecified'],
    ['::ffff:127.0.0.1', 'IPv4-mapped'],
    ['::ffff:8.8.8.8', 'IPv4-mapped'],
    ['::ffff:7f00:1', 'IPv4-mapped'],
    ['fc00::1', 'unique local (ULA)'],
    ['fd12:3456:789a::1', 'unique local (ULA)'],
    ['fe80::1%eth0', 'link-local'],
    ['febf::1', 'link-local'],
    ['ff02::1', 'multicast'],
    ['2001:db8::1', 'documentation'],
    ['2002:7f00:1::', '6to4'],
    ['2001:0:4136:e378::1', 'IETF protocol assignments (incl. Teredo)'],
    ['64:ff9b::7f00:1', 'NAT64 of a non-public IPv4'],
  ])('refuses %s (%s)', (ip, why) => {
    expect(blockedAddress(ip)).toBe(why);
  });

  it.each([
    '8.8.8.8',
    '93.184.216.34',
    '172.32.0.1',
    '100.128.0.1',
    '2606:4700::1111',
    '64:ff9b::808:808',
  ])('allows public %s', (ip) => {
    expect(blockedAddress(ip)).toBeNull();
  });

  it('parses IPv6 forms', () => {
    expect(parseIPv6('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIPv6('[2001:db8::8:800:200c:417a]')).toEqual([
      0x2001, 0xdb8, 0, 0, 8, 0x800, 0x200c, 0x417a,
    ]);
    expect(parseIPv6('::ffff:1.2.3.4')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x102, 0x304]);
    expect(parseIPv6('1:2:3:4:5:6:7:8:9')).toBeNull();
    expect(parseIPv6('1::2::3')).toBeNull();
    expect(parseIPv6('hello')).toBeNull();
  });
});

describe('checkUrlShape', () => {
  it.each([
    'file:///etc/passwd',
    'ftp://example.com/a',
    'gopher://example.com/',
    'javascript:alert(1)',
    'http://user:pw@example.com/',
    'http://example.com:8080/',
    'https://example.com:22/',
    'http://localhost/',
    'http://localhost./',
    'http://printer.local/',
    'http://db.internal/',
    'http://intranet/',
    'http://127.0.0.1/',
    'http://2130706433/', // 127.0.0.1 as one number
    'http://0x7f.1/', // 127.0.0.1 in hex shorthand
    'http://0177.0.0.1/', // octal
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[fd00::1]/',
    'http://169.254.169.254/latest/meta-data/',
    'not a url',
  ])('refuses %s', (url) => {
    expect(() => checkUrlShape(url)).toThrow();
  });

  it('keeps a normal address and drops the fragment', () => {
    expect(checkUrlShape('https://example.com/news/a?id=1#top').href).toBe(
      'https://example.com/news/a?id=1',
    );
    expect(checkUrlShape('http://example.com:80/').href).toBe('http://example.com/');
  });
});

describe('checkUrl (DNS)', () => {
  const dns =
    (table: Record<string, string[]>): Resolver =>
    async (h) =>
      table[h] ?? [];
  it('refuses a host with any non-public answer (DNS rebinding with mixed answers)', async () => {
    const r = dns({ 'evil.example': ['93.184.216.34', '10.0.0.5'] });
    await expect(checkUrl('https://evil.example/', r)).rejects.toThrow(/private/);
  });
  it('refuses a host that resolves to an IPv6 ULA or a mapped loopback', async () => {
    await expect(
      checkUrl('https://a.example/', dns({ 'a.example': ['fd00::5'] })),
    ).rejects.toThrow();
    await expect(
      checkUrl('https://b.example/', dns({ 'b.example': ['::ffff:127.0.0.1'] })),
    ).rejects.toThrow();
  });
  it('refuses a host with no address and a failing resolver', async () => {
    await expect(checkUrl('https://none.example/', dns({}))).rejects.toThrow(/no address/);
    await expect(
      checkUrl('https://x.example/', async () => {
        throw new Error('SERVFAIL');
      }),
    ).rejects.toThrow(/DNS/);
  });
  it('allows a host with only public answers', async () => {
    const r = dns({ 'ok.example': ['93.184.216.34', '2606:2800:220:1::1'] });
    expect((await checkUrl('https://ok.example/a', r)).href).toBe('https://ok.example/a');
  });
});

// ------------------------------------------------------------------ robots.txt

describe('robotsAllows', () => {
  const txt = `
User-agent: *
Disallow: /private/
Allow: /private/open$
Disallow: /*.pdf$

User-agent: BadBot
Disallow: /
`;
  it('applies the * group to EngappReader', () => {
    expect(robotsAllows(txt, '/news/a')).toBe(true);
    expect(robotsAllows(txt, '/private/a')).toBe(false);
    expect(robotsAllows(txt, '/private/open')).toBe(true);
    expect(robotsAllows(txt, '/private/open/more')).toBe(false);
    expect(robotsAllows(txt, '/files/a.pdf')).toBe(false);
    expect(robotsAllows(txt, '/files/a.pdf?x=1')).toBe(true);
  });
  it('prefers a group naming EngappReader (case-insensitive) over *', () => {
    const own = `User-agent: *\nDisallow: /\n\nUser-agent: engappreader\nAllow: /\nDisallow: /drafts`;
    expect(robotsAllows(own, '/news')).toBe(true);
    expect(robotsAllows(own, '/drafts/1')).toBe(false);
    const blocked = `User-agent: EngappReader\nDisallow: /\n\nUser-agent: *\nAllow: /`;
    expect(robotsAllows(blocked, '/news')).toBe(false);
  });
  it('joins consecutive user-agent lines into one group and ignores other lines', () => {
    const t = `User-agent: Foo\nUser-agent: EngappReader\nCrawl-delay: 5\nDisallow: /x\nSitemap: https://e.com/s.xml`;
    expect(robotsAllows(t, '/x/1')).toBe(false);
    expect(robotsAllows(t, '/y')).toBe(true);
  });
  it('allows everything for an empty Disallow, an empty file and robots.txt itself', () => {
    expect(robotsAllows('User-agent: *\nDisallow:', '/a')).toBe(true);
    expect(robotsAllows('', '/a')).toBe(true);
    expect(robotsAllows('User-agent: *\nDisallow: /', '/robots.txt')).toBe(true);
  });
  it('lets the longest match win and Allow win a tie', () => {
    const t = `User-agent: *\nDisallow: /a\nAllow: /a/b\nDisallow: /a/b/c\nAllow: /t\nDisallow: /t`;
    expect(robotsAllows(t, '/a/x')).toBe(false);
    expect(robotsAllows(t, '/a/b/x')).toBe(true);
    expect(robotsAllows(t, '/a/b/c')).toBe(false);
    expect(robotsAllows(t, '/t')).toBe(true);
  });
});

// ------------------------------------------------------------------ the function

interface Route {
  status?: number;
  headers?: Record<string, string>;
  body?: string | Uint8Array | ReadableStream<Uint8Array>;
  /** never answers (until aborted) */
  hang?: boolean;
}

function harness(
  routes: Record<string, Route>,
  dnsTable: Record<string, string[]> = {},
  opts: { limit?: number; used?: number; timeoutMs?: number } = {},
) {
  const requested: { url: string; init: RequestInit | undefined }[] = [];
  let used = opts.used ?? 0;
  const consumed: string[] = [];
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requested.push({ url, init });
    const r = routes[url];
    if (r?.hang) {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      });
    }
    if (!r) return new Response('not found', { status: 404 });
    return new Response((r.body ?? '') as BodyInit, {
      status: r.status ?? 200,
      headers: r.headers ?? {},
    });
  }) as typeof fetch;
  const deps: ArticleDeps = {
    userId: 'u1',
    store: {
      async consume(userId, limit) {
        consumed.push(userId);
        if (used >= limit) return { allowed: false, used, limit };
        used++;
        return { allowed: true, used, limit };
      },
    },
    resolve: async (h) => dnsTable[h] ?? ['93.184.216.34'],
    fetch: fakeFetch,
    dailyLimit: opts.limit ?? 30,
    timeoutMs: opts.timeoutMs,
  };
  return { deps, requested, consumed };
}

const html = (name: string): Route => ({
  headers: { 'content-type': 'text/html; charset=utf-8' },
  body: fixture(name),
});

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    if (e instanceof ApiError) return e.code;
    throw e;
  }
}

describe('runFetchArticle', () => {
  it('returns plain paragraphs, title, byline and site', async () => {
    const h = harness({ 'https://news.example/city/bikes': html('01-news.html') });
    const res = await runFetchArticle({ url: 'https://news.example/city/bikes' }, h.deps);
    expect(articleResponse.parse(res)).toEqual(res);
    expect(res.title).toBe('City council approves new bike lanes after long debate');
    expect(res.byline).toBe('Lena Ortiz');
    expect(res.site).toBe('The Riverside Gazette');
    expect(res.paragraphs).toHaveLength(5);
    expect(res.usage).toEqual({ used: 1, limit: 30 });
    expect(JSON.stringify(res)).not.toMatch(/<[a-z]/i);
    // robots.txt first, then the page, both with our user agent and no automatic redirects
    expect(h.requested.map((r) => r.url)).toEqual([
      'https://news.example/robots.txt',
      'https://news.example/city/bikes',
    ]);
    for (const r of h.requested) {
      expect(new Headers(r.init?.headers).get('user-agent')).toBe(ARTICLE_USER_AGENT);
      expect(r.init?.redirect).toBe('manual');
    }
  });

  it('refuses a private address before using a fetch of the day', async () => {
    const h = harness({});
    expect(await code(runFetchArticle({ url: 'http://192.168.1.1/admin' }, h.deps))).toBe(
      'blocked_url',
    );
    expect(await code(runFetchArticle({ url: 'file:///etc/passwd' }, h.deps))).toBe('blocked_url');
    expect(h.consumed).toEqual([]);
    expect(h.requested).toEqual([]);
  });

  it('refuses a host whose DNS points at a private address', async () => {
    const h = harness({}, { 'rebind.example': ['127.0.0.1'] });
    expect(await code(runFetchArticle({ url: 'https://rebind.example/' }, h.deps))).toBe(
      'blocked_url',
    );
    expect(h.requested).toEqual([]);
  });

  it('refuses a redirect to a private IP, re-checking every hop', async () => {
    const h = harness({
      'https://a.example/start': { status: 302, headers: { location: 'https://b.example/next' } },
      'https://b.example/next': {
        status: 301,
        headers: { location: 'http://169.254.169.254/latest/meta-data/' },
      },
    });
    expect(await code(runFetchArticle({ url: 'https://a.example/start' }, h.deps))).toBe(
      'blocked_url',
    );
    expect(h.requested.map((r) => r.url)).not.toContain('http://169.254.169.254/latest/meta-data/');
  });

  it('refuses a redirect to a host that resolves privately', async () => {
    const h = harness(
      { 'https://a.example/': { status: 307, headers: { location: 'https://inside.example/' } } },
      { 'inside.example': ['10.0.0.8'] },
    );
    expect(await code(runFetchArticle({ url: 'https://a.example/' }, h.deps))).toBe('blocked_url');
    expect(h.requested.map((r) => r.url)).not.toContain('https://inside.example/');
  });

  it('follows up to 3 redirects and gives up after that', async () => {
    const ok = harness({
      'https://r.example/0': { status: 301, headers: { location: '/1' } },
      'https://r.example/1': { status: 302, headers: { location: '/2' } },
      'https://r.example/2': { status: 303, headers: { location: 'https://final.example/a' } },
      'https://final.example/a': html('02-blog.html'),
    });
    const res = await runFetchArticle({ url: 'https://r.example/0' }, ok.deps);
    expect(res.url).toBe('https://final.example/a');
    expect(res.title).toMatch(/tomatoes/);

    const tooMany = harness({
      'https://r.example/0': { status: 301, headers: { location: '/1' } },
      'https://r.example/1': { status: 301, headers: { location: '/2' } },
      'https://r.example/2': { status: 301, headers: { location: '/3' } },
      'https://r.example/3': { status: 301, headers: { location: '/4' } },
      'https://r.example/4': html('02-blog.html'),
    });
    expect(await code(runFetchArticle({ url: 'https://r.example/0' }, tooMany.deps))).toBe(
      'fetch_failed',
    );
    expect(tooMany.requested.map((r) => r.url)).not.toContain('https://r.example/4');
  });

  it('refuses a page over 2 MB, by header and by streamed size', async () => {
    const declared = harness({
      'https://big.example/a': {
        headers: { 'content-type': 'text/html', 'content-length': String(MAX_PAGE_BYTES + 1) },
        body: '<html></html>',
      },
    });
    expect(await code(runFetchArticle({ url: 'https://big.example/a' }, declared.deps))).toBe(
      'too_large',
    );

    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        sent += 256 * 1024;
        c.enqueue(new Uint8Array(256 * 1024).fill(0x61));
        if (sent > 4 * MAX_PAGE_BYTES) c.close();
      },
    });
    const streamed = harness({
      'https://big.example/b': { headers: { 'content-type': 'text/html' }, body: stream },
    });
    expect(await code(runFetchArticle({ url: 'https://big.example/b' }, streamed.deps))).toBe(
      'too_large',
    );
    expect(sent).toBeLessThan(2 * MAX_PAGE_BYTES);
  });

  it('refuses anything that is not text/html', async () => {
    for (const type of ['application/pdf', 'application/json', 'image/png', 'text/plain', '']) {
      const h = harness({
        'https://x.example/f': { headers: { 'content-type': type }, body: 'x' },
      });
      expect(await code(runFetchArticle({ url: 'https://x.example/f' }, h.deps))).toBe('not_html');
    }
  });

  it('honours robots.txt for EngappReader, also on a redirect target', async () => {
    const disallow = harness({
      'https://site.example/robots.txt': {
        headers: { 'content-type': 'text/plain' },
        body: 'User-agent: EngappReader\nDisallow: /news/',
      },
      'https://site.example/news/a': html('01-news.html'),
    });
    expect(await code(runFetchArticle({ url: 'https://site.example/news/a' }, disallow.deps))).toBe(
      'robots_disallowed',
    );
    expect(disallow.requested.map((r) => r.url)).not.toContain('https://site.example/news/a');

    const viaRedirect = harness({
      'https://short.example/x': {
        status: 301,
        headers: { location: 'https://site.example/news/a' },
      },
      'https://site.example/robots.txt': { body: 'User-agent: *\nDisallow: /' },
      'https://site.example/news/a': html('01-news.html'),
    });
    expect(await code(runFetchArticle({ url: 'https://short.example/x' }, viaRedirect.deps))).toBe(
      'robots_disallowed',
    );
  });

  it('treats a missing robots.txt as allow and a failing one as disallow (RFC 9309)', async () => {
    const missing = harness({ 'https://m.example/a': html('03-magazine.html') });
    expect(await code(runFetchArticle({ url: 'https://m.example/a' }, missing.deps))).toBe('ok');
    const failing = harness({
      'https://m.example/robots.txt': { status: 503 },
      'https://m.example/a': html('03-magazine.html'),
    });
    expect(await code(runFetchArticle({ url: 'https://m.example/a' }, failing.deps))).toBe(
      'robots_disallowed',
    );
  });

  it('stops after the 10 s deadline', async () => {
    const h = harness({ 'https://slow.example/a': { hang: true } }, {}, { timeoutMs: 30 });
    expect(await code(runFetchArticle({ url: 'https://slow.example/a' }, h.deps))).toBe(
      'fetch_failed',
    );
  });

  it('enforces the daily limit', async () => {
    const h = harness({ 'https://d.example/a': html('01-news.html') }, {}, { limit: 30, used: 30 });
    expect(await code(runFetchArticle({ url: 'https://d.example/a' }, h.deps))).toBe('daily_limit');
    expect(h.requested).toEqual([]);
  });

  it('maps a paywall, an empty page and HTTP errors to clear codes', async () => {
    const cases: [Route, string][] = [
      [html('04-paywall.html'), 'paywalled'],
      [html('05-spa-shell.html'), 'extract_failed'],
      [html('10-consent-wall.html'), 'extract_failed'],
      [{ status: 402, headers: { 'content-type': 'text/html' }, body: '' }, 'paywalled'],
      [{ status: 404, headers: { 'content-type': 'text/html' }, body: '' }, 'fetch_failed'],
      [{ status: 500, headers: { 'content-type': 'text/html' }, body: '' }, 'fetch_failed'],
    ];
    for (const [route, want] of cases) {
      const h = harness({ 'https://p.example/a': route });
      expect(await code(runFetchArticle({ url: 'https://p.example/a' }, h.deps))).toBe(want);
    }
  });

  it('rejects an invalid body', async () => {
    const h = harness({});
    expect(await code(runFetchArticle({}, h.deps))).toBe('invalid_input');
    expect(await code(runFetchArticle({ url: 'x'.repeat(3000) }, h.deps))).toBe('invalid_input');
  });
});

// ------------------------------------------------------------------ Readability fixtures

describe('extractArticle fixtures', () => {
  const BOILERPLATE = [
    /cookie/i,
    /subscribe/i,
    /newsletter/i,
    /related stories/i,
    /all rights reserved/i,
    /advertisement/i,
    /comments \(/i,
    /great read/i,
    /\[edit\]/,
    /archives/i,
  ];
  const ok = (name: string) => {
    const r = extractArticle(fixtureText(name), 'https://www.example.com/a');
    if (!r.ok) throw new Error(`${name}: ${r.reason} ${r.detail}`);
    const all = r.article.paragraphs.join('\n');
    for (const b of BOILERPLATE) expect(all, `${name} keeps ${b}`).not.toMatch(b);
    expect(all).not.toMatch(/<[a-z/]/i);
    return r.article;
  };

  it('news article: body only, no menus, ads, comments or figure caption', () => {
    const a = ok('01-news.html');
    expect(a.paragraphs[0]).toMatch(/^After more than four hours/);
    expect(a.paragraphs.join(' ')).not.toMatch(/Photo: Staff/);
    expect(a.lang).toBe('en');
  });

  it('blog post: keeps the post, drops sidebar widgets and comments', () => {
    const a = ok('02-blog.html');
    expect(a.title).toBe('What I learned from a year of growing tomatoes on a balcony');
    expect(a.paragraphs).toHaveLength(5);
    expect(a.site).toBe('Small Space Gardener');
  });

  it('magazine: keeps subheadings and the pull quote as their own paragraphs', () => {
    const a = ok('03-magazine.html');
    expect(a.paragraphs).toContain('Rhythm gives words a shape');
    expect(a.byline).toBe('Priya Natarajan');
  });

  it('windows-1252 page: curly quotes and accents decode', () => {
    const a = ok('06-cp1252.bin');
    expect(a.title).toBe('A small café that refuses to grow');
    expect(a.paragraphs.join(' ')).toContain('“People come here');
    expect(a.byline).toBe('Ana Lima');
    expect(a.paragraphs[0]).toMatch(/^The café on Mill Street/);
  });

  it('table layout with <br><br> paragraphs: no sidebar links', () => {
    const a = ok('07-br-layout.html');
    expect(a.paragraphs).toHaveLength(4);
    expect(a.paragraphs.join(' ')).not.toMatch(/\bGuides\b/);
  });

  it('wiki page: no edit links, no footnote marks, no table of contents', () => {
    const a = ok('08-wiki.html');
    expect(a.paragraphs[0]).toMatch(/^A honeybee is a social insect that lives/);
    expect(a.paragraphs[0]).not.toContain('[1]');
    expect(a.paragraphs).toContain('Life in the hive');
  });

  it('another language: extracted, with its lang reported', () => {
    expect(ok('09-german.html').lang).toBe('de');
  });

  it('paywall teaser, script shell and consent wall do not count as articles', () => {
    expect(extractArticle(fixtureText('04-paywall.html'), 'https://a.example/')).toMatchObject({
      ok: false,
      reason: 'paywalled',
    });
    for (const f of ['05-spa-shell.html', '10-consent-wall.html']) {
      expect(extractArticle(fixtureText(f), 'https://a.example/')).toMatchObject({
        ok: false,
        reason: 'extract_failed',
      });
    }
  });
});
