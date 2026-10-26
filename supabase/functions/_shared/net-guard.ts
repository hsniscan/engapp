// SSRF guard of fetch-article (decision 0044): which addresses the server may fetch for a user.
// Only http(s) on the default ports, no credentials in the URL, and a host whose every DNS
// answer is a public unicast address. Pure apart from the injected resolver.

export type AddressFamily = 4 | 6;

/** Resolves a host name to its IPv4 and IPv6 addresses (empty when there are none). */
export type Resolver = (host: string) => Promise<string[]>;

export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlockedUrlError';
  }
}

/** Parses "a.b.c.d" (already normalised by the URL parser) to 32 bits, or null. */
export function parseIPv4(s: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  let n = 0;
  for (let i = 1; i <= 4; i++) {
    const o = Number(m[i]);
    if (o > 255) return null;
    n = n * 256 + o;
  }
  return n;
}

/** Parses an IPv6 address (with an optional embedded IPv4 tail) to eight 16-bit groups. */
export function parseIPv6(input: string): number[] | null {
  let s = input.trim();
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  if (!/^[0-9a-fA-F:.]+$/.test(s) || !s.includes(':')) return null;

  let tail: number[] = [];
  const lastColon = s.lastIndexOf(':');
  const last = s.slice(lastColon + 1);
  if (last.includes('.')) {
    const v4 = parseIPv4(last);
    if (v4 === null) return null;
    tail = [Math.floor(v4 / 65536), v4 % 65536];
    s = s.slice(0, lastColon + 1) + '0';
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const parse = (part: string) => (part === '' ? [] : part.split(':'));
  const head = parse(halves[0]!);
  const rest = halves.length === 2 ? parse(halves[1]!) : [];
  const groups = [...head, ...rest];
  if (groups.some((g) => !/^[0-9a-fA-F]{1,4}$/.test(g))) return null;
  // The '0' placeholder of an IPv4 tail counts as one group but stands for two.
  const want = 8 - (tail.length ? 1 : 0);
  let out: number[];
  if (halves.length === 2) {
    const missing = want - groups.length;
    if (missing < 1) return null;
    out = [...head, ...Array<string>(missing).fill('0'), ...rest].map((g) => parseInt(g, 16));
  } else {
    if (groups.length !== want) return null;
    out = groups.map((g) => parseInt(g, 16));
  }
  if (tail.length) out = [...out.slice(0, 6), ...tail];
  return out.length === 8 ? out : null;
}

const v4 = (a: number, b: number, c: number, d: number) => ((a * 256 + b) * 256 + c) * 256 + d;

/** Non-public IPv4 ranges: [first address, prefix length, why]. */
const V4_BLOCKED: readonly [number, number, string][] = [
  [v4(0, 0, 0, 0), 8, 'this network'],
  [v4(10, 0, 0, 0), 8, 'private'],
  [v4(100, 64, 0, 0), 10, 'carrier-grade NAT'],
  [v4(127, 0, 0, 0), 8, 'loopback'],
  [v4(169, 254, 0, 0), 16, 'link-local'],
  [v4(172, 16, 0, 0), 12, 'private'],
  [v4(192, 0, 0, 0), 24, 'IETF protocol assignments'],
  [v4(192, 0, 2, 0), 24, 'documentation'],
  [v4(192, 31, 196, 0), 24, 'AS112'],
  [v4(192, 52, 193, 0), 24, 'AMT'],
  [v4(192, 88, 99, 0), 24, '6to4 relay'],
  [v4(192, 168, 0, 0), 16, 'private'],
  [v4(192, 175, 48, 0), 24, 'AS112'],
  [v4(198, 18, 0, 0), 15, 'benchmarking'],
  [v4(198, 51, 100, 0), 24, 'documentation'],
  [v4(203, 0, 113, 0), 24, 'documentation'],
  [v4(224, 0, 0, 0), 4, 'multicast'],
  [v4(240, 0, 0, 0), 4, 'reserved / broadcast'],
];

function inV4(addr: number, base: number, prefix: number): boolean {
  const size = 2 ** (32 - prefix);
  return addr >= base && addr < base + size;
}

/** Why an IPv4 address is not public, or null when it is. */
export function blockedIPv4(addr: number): string | null {
  for (const [base, prefix, why] of V4_BLOCKED) if (inV4(addr, base, prefix)) return why;
  return null;
}

/** Why an IPv6 address is not public, or null when it is. */
export function blockedIPv6(g: number[]): string | null {
  const embedded = (hi: number, lo: number) => blockedIPv4(hi * 65536 + lo);
  if (g.every((x) => x === 0)) return 'unspecified';
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return 'loopback';
  // ::ffff:a.b.c.d (IPv4-mapped) and ::a.b.c.d (IPv4-compatible, deprecated): refused outright,
  // a public IPv4 server is reachable by its IPv4 address.
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return 'IPv4-mapped';
  // ::ffff:0:a.b.c.d (IPv4-translated)
  if (g.slice(0, 4).every((x) => x === 0) && g[4] === 0xffff && g[5] === 0)
    return 'IPv4-translated';
  // 64:ff9b::/96 and 64:ff9b:1::/48 (NAT64): check the IPv4 inside.
  if (g[0] === 0x64 && g[1] === 0xff9b) {
    if (g[2] === 1) return 'local NAT64';
    if (g.slice(2, 6).every((x) => x === 0))
      return embedded(g[6]!, g[7]!) && 'NAT64 of a non-public IPv4';
  }
  if (g[0] === 0x100 && g.slice(1, 4).every((x) => x === 0)) return 'discard-only';
  if (g[0] === 0x2001 && g[1]! < 0x200) return 'IETF protocol assignments (incl. Teredo)';
  if (g[0] === 0x2001 && g[1] === 0xdb8) return 'documentation';
  if (g[0] === 0x2002) return '6to4';
  if (g[0] === 0x3fff && g[1]! < 0x1000) return 'documentation';
  if (g[0] === 0x5f00) return 'segment routing';
  if ((g[0]! & 0xfe00) === 0xfc00) return 'unique local (ULA)';
  if ((g[0]! & 0xffc0) === 0xfe80) return 'link-local';
  if ((g[0]! & 0xffc0) === 0xfec0) return 'site-local';
  if ((g[0]! & 0xff00) === 0xff00) return 'multicast';
  // Only global unicast (2000::/3) is public.
  if ((g[0]! & 0xe000) !== 0x2000) return 'not global unicast';
  return null;
}

/** Why an address literal is not public; 'not an IP address' when it is not one. */
export function blockedAddress(ip: string): string | null {
  const a = parseIPv4(ip);
  if (a !== null) return blockedIPv4(a);
  const b = parseIPv6(ip);
  if (b) return blockedIPv6(b);
  return 'not an IP address';
}

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa', '.lan', '.intranet'];

/**
 * Checks the shape of a URL: http(s), default port, no credentials, a dotted host name or a
 * public address literal. Returns the parsed URL with its fragment removed.
 */
export function checkUrlShape(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new BlockedUrlError('not a URL');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new BlockedUrlError('scheme');
  if (u.username || u.password) throw new BlockedUrlError('credentials in URL');
  // The URL parser drops a default port, so any port left is a non-default one.
  if (u.port !== '') throw new BlockedUrlError('non-default port');
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) throw new BlockedUrlError('no host');
  u.hash = '';
  const literal = host.startsWith('[') ? host.slice(1, -1) : host;
  if (parseIPv4(literal) !== null || parseIPv6(literal)) {
    const why = blockedAddress(literal);
    if (why) throw new BlockedUrlError(`address is ${why}`);
    return u;
  }
  if (host === 'localhost' || BLOCKED_SUFFIXES.some((s) => host.endsWith(s)))
    throw new BlockedUrlError('local host name');
  if (!host.includes('.')) throw new BlockedUrlError('single-label host name');
  return u;
}

/**
 * Full check of one hop: the URL shape, then every resolved address of its host. A host
 * with no address, or with any non-public one, is refused (an attacker controls the DNS of
 * their own domain, so one private answer is enough to refuse).
 */
export async function checkUrl(raw: string, resolve: Resolver): Promise<URL> {
  const u = checkUrlShape(raw);
  const host = u.hostname.startsWith('[') ? u.hostname.slice(1, -1) : u.hostname;
  if (parseIPv4(host) !== null || parseIPv6(host)) return u;
  let addrs: string[];
  try {
    addrs = await resolve(host);
  } catch (e) {
    throw new BlockedUrlError(`DNS: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (addrs.length === 0) throw new BlockedUrlError('host has no address');
  for (const a of addrs) {
    const why = blockedAddress(a);
    if (why) throw new BlockedUrlError(`host resolves to a ${why} address`);
  }
  return u;
}

interface DnsJson {
  Status?: number;
  Answer?: { type?: number; data?: string }[];
}

/**
 * DNS over HTTPS (RFC 8484 JSON form) as a fallback where Deno.resolveDns is not available.
 * Default resolver: Cloudflare 1.1.1.1.
 */
export function dohResolver(
  doFetch: typeof fetch,
  endpoint = 'https://cloudflare-dns.com/dns-query',
): Resolver {
  return async (host) => {
    const q = async (type: 'A' | 'AAAA', code: number) => {
      const res = await doFetch(`${endpoint}?name=${encodeURIComponent(host)}&type=${type}`, {
        headers: { accept: 'application/dns-json' },
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) throw new Error(`DoH HTTP ${res.status}`);
      const j = (await res.json()) as DnsJson;
      if (j.Status !== 0 && j.Status !== 3) throw new Error(`DoH status ${j.Status}`);
      return (j.Answer ?? [])
        .filter((a) => a.type === code && typeof a.data === 'string')
        .map((a) => a.data!);
    };
    const [a, aaaa] = await Promise.all([q('A', 1), q('AAAA', 28)]);
    return [...a, ...aaaa];
  };
}
