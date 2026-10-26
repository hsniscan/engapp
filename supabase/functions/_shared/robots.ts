// robots.txt for fetch-article (RFC 9309). Thin, own code: group selection by product token,
// Allow / Disallow with `*` and `$`, longest match wins, Allow wins a tie.

export const ARTICLE_USER_AGENT_TOKEN = 'EngappReader';

interface Rule {
  allow: boolean;
  pattern: string;
}

interface Group {
  agents: string[];
  rules: Rule[];
}

export function parseRobots(text: string): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (key === 'allow' || key === 'disallow') {
      lastWasAgent = false;
      if (!current) continue;
      // An empty Disallow allows everything: no rule.
      if (value === '') continue;
      current.rules.push({ allow: key === 'allow', pattern: value });
    }
    // Sitemap, Crawl-delay and other lines are not rules and do not end a group.
  }
  return groups;
}

/** Percent-encoding normalised so "/a%7eb" and "/a~b" compare equal. */
function normalise(path: string): string {
  return path.replace(/%([0-9a-fA-F]{2})/g, (m, hex: string) => {
    const c = String.fromCharCode(parseInt(hex, 16));
    return /[A-Za-z0-9\-._~]/.test(c) ? c : m.toUpperCase();
  });
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = normalise(anchored ? pattern.slice(0, -1) : pattern);
  const re = new RegExp(
    '^' +
      body
        .split('*')
        .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*') +
      (anchored ? '$' : ''),
  );
  return re.test(path);
}

/** May `agentToken` fetch `pathAndQuery` (e.g. "/news/a?id=1")? */
export function robotsAllows(
  text: string,
  pathAndQuery: string,
  agentToken = ARTICLE_USER_AGENT_TOKEN,
): boolean {
  const groups = parseRobots(text);
  const token = agentToken.toLowerCase();
  let selected = groups.filter((g) => g.agents.includes(token));
  if (selected.length === 0) selected = groups.filter((g) => g.agents.includes('*'));
  const rules = selected.flatMap((g) => g.rules);
  const path = normalise(pathAndQuery || '/');
  if (path === '/robots.txt') return true;
  let best: Rule | null = null;
  let bestLen = -1;
  for (const r of rules) {
    if (!matches(r.pattern, path)) continue;
    const len = r.pattern.length;
    if (len > bestLen || (len === bestLen && r.allow && !best?.allow)) {
      best = r;
      bestLen = len;
    }
  }
  return best ? best.allow : true;
}
