/**
 * Licence check of every installed npm package, production and development (decision 0053),
 * run by CI after `pnpm install`:
 *
 *   node scripts/check-licenses.ts            # runs `pnpm licenses list --json`
 *   node scripts/check-licenses.ts <file.json>  # or reads that output from a file
 *
 * A package passes when its licence (an SPDX expression) is satisfied by the allowlist: for
 * `A OR B` one side is enough, for `A AND B` both must be allowed. Anything else fails the
 * build, unless it is one of the reviewed exceptions below, which name the package and the
 * exact licence they were reviewed for (a licence change fails again). The Python worker
 * (scripts/tts-requirements.txt) and the Android libraries are not npm packages and are
 * reviewed by hand in their decision records.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export const ALLOWED = new Set([
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  '0BSD',
  'CC0-1.0',
  'Unlicense',
  'Python-2.0',
  'BlueOak-1.0.0',
]);

/** Common non-SPDX spellings in package.json files. */
const ALIASES: Record<string, string> = {
  'Apache 2.0': 'Apache-2.0',
  'Apache License 2.0': 'Apache-2.0',
  'Apache-2': 'Apache-2.0',
  'BSD-2': 'BSD-2-Clause',
  'BSD-3': 'BSD-3-Clause',
  CC0: 'CC0-1.0',
  'MIT License': 'MIT',
  'The Unlicense': 'Unlicense',
};

/**
 * Reviewed exceptions: commercial use is allowed, but the licence is not on the allowlist.
 * Key: package name; value: the exact licence string reviewed, and why it is acceptable.
 */
export const REVIEWED: Record<string, { license: string; why: string }> = {
  '@fontsource/source-serif-4': {
    license: 'OFL-1.1',
    why: 'the Source Serif 4 font (shipped); SIL Open Font License allows commercial use and embedding',
  },
  pako: {
    license: '(MIT AND Zlib)',
    why: 'used by jszip (shipped); the zlib licence is permissive (no copyleft, commercial use allowed)',
  },
  'axe-core': {
    license: 'MPL-2.0',
    why: 'accessibility checks in e2e tests only, never shipped',
  },
  '@axe-core/playwright': {
    license: 'MPL-2.0',
    why: 'accessibility checks in e2e tests only, never shipped',
  },
  '@resvg/resvg-wasm': {
    license: 'MPL-2.0',
    why: 'renders the app icons at development time (scripts/generate-icons.ts), never shipped',
  },
  lightningcss: {
    license: 'MPL-2.0',
    why: 'CSS build tool (Tailwind, Vite); its output is our CSS, the tool itself is not shipped',
  },
  'lightningcss-linux-x64-gnu': { license: 'MPL-2.0', why: 'binary of lightningcss (build tool)' },
  'lightningcss-linux-x64-musl': { license: 'MPL-2.0', why: 'binary of lightningcss (build tool)' },
  'lightningcss-darwin-arm64': { license: 'MPL-2.0', why: 'binary of lightningcss (build tool)' },
  'lightningcss-darwin-x64': { license: 'MPL-2.0', why: 'binary of lightningcss (build tool)' },
  'lightningcss-win32-x64-msvc': { license: 'MPL-2.0', why: 'binary of lightningcss (build tool)' },
  'caniuse-lite': {
    license: 'CC-BY-4.0',
    why: 'browser support data read by the build tools, never shipped; CC BY allows commercial use',
  },
  '@csstools/color-helpers': {
    license: 'MIT-0',
    why: 'MIT without the attribution clause (more permissive than MIT); test tooling (jsdom)',
  },
  '@csstools/css-syntax-patches-for-csstree': {
    license: 'MIT-0',
    why: 'MIT without the attribution clause (more permissive than MIT); test tooling (jsdom)',
  },
};

// ------------------------------------------------------------------ SPDX expressions

type Node = { id: string } | { op: 'AND' | 'OR'; left: Node; right: Node };

function tokenize(expr: string): string[] {
  return expr
    .replace(/([()])/g, ' $1 ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Parses an SPDX licence expression (AND binds tighter than OR); throws on bad input. */
export function parseSpdx(expr: string): Node {
  const t = tokenize(expr);
  let i = 0;
  const primary = (): Node => {
    const tok = t[i++];
    if (tok === undefined) throw new Error(`unexpected end in "${expr}"`);
    if (tok === '(') {
      const n = or();
      if (t[i++] !== ')') throw new Error(`missing ) in "${expr}"`);
      return n;
    }
    if (tok === ')' || tok === 'AND' || tok === 'OR')
      throw new Error(`unexpected ${tok} in "${expr}"`);
    let id = tok;
    // "X WITH exception": kept whole, so it only passes as a reviewed exception.
    if (t[i] === 'WITH') {
      id = `${tok} WITH ${t[i + 1] ?? ''}`;
      i += 2;
    }
    return { id };
  };
  const and = (): Node => {
    let n = primary();
    while (t[i] === 'AND') {
      i++;
      n = { op: 'AND', left: n, right: primary() };
    }
    return n;
  };
  const or = (): Node => {
    let n = and();
    while (t[i] === 'OR') {
      i++;
      n = { op: 'OR', left: n, right: and() };
    }
    return n;
  };
  const n = or();
  if (i !== t.length) throw new Error(`unexpected ${t[i]} in "${expr}"`);
  return n;
}

function satisfied(n: Node, allowed: ReadonlySet<string>): boolean {
  if ('id' in n) return allowed.has(ALIASES[n.id] ?? n.id.replace(/\+$/, ''));
  return n.op === 'AND'
    ? satisfied(n.left, allowed) && satisfied(n.right, allowed)
    : satisfied(n.left, allowed) || satisfied(n.right, allowed);
}

/** True when the licence string is allowed by the allowlist alone. */
export function isAllowed(license: string, allowed: ReadonlySet<string> = ALLOWED): boolean {
  const trimmed = license.trim();
  const s = ALIASES[trimmed] ?? trimmed; // multi-word spellings ("Apache 2.0") as a whole
  if (!s || /^(unknown|unlicensed|see license in)/i.test(s)) return false;
  try {
    return satisfied(parseSpdx(s), allowed);
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ the check

export interface PackageLicense {
  name: string;
  versions: string[];
  license: string;
}

/** `pnpm licenses list --json`: { "<licence>": [{ name, versions, license, … }] } */
export function fromPnpmJson(json: unknown): PackageLicense[] {
  const out: PackageLicense[] = [];
  for (const [key, list] of Object.entries(json as Record<string, unknown[]>)) {
    for (const p of list as { name: string; versions?: string[]; license?: string }[]) {
      out.push({ name: p.name, versions: p.versions ?? [], license: p.license ?? key });
    }
  }
  return out;
}

export interface CheckResult {
  checked: number;
  failed: PackageLicense[];
  reviewed: (PackageLicense & { why: string })[];
}

export function checkLicenses(
  pkgs: readonly PackageLicense[],
  reviewed: Record<string, { license: string; why: string }> = REVIEWED,
): CheckResult {
  const failed: PackageLicense[] = [];
  const ok: CheckResult['reviewed'] = [];
  for (const p of pkgs) {
    if (isAllowed(p.license)) continue;
    const r = reviewed[p.name];
    if (r && r.license === p.license) ok.push({ ...p, why: r.why });
    else failed.push(p);
  }
  const byName = (a: PackageLicense, b: PackageLicense) => a.name.localeCompare(b.name);
  return { checked: pkgs.length, failed: failed.sort(byName), reviewed: ok.sort(byName) };
}

function main(): void {
  const file = process.argv[2];
  const raw = file
    ? readFileSync(file, 'utf8')
    : execFileSync('pnpm', ['licenses', 'list', '--json'], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      });
  const r = checkLicenses(fromPnpmJson(JSON.parse(raw)));
  console.log(`licences: ${r.checked} packages checked, ${r.reviewed.length} reviewed exceptions`);
  for (const p of r.reviewed) console.log(`  reviewed  ${p.name} (${p.license}): ${p.why}`);
  for (const p of r.failed) {
    console.log(
      `::error::${p.name}@${p.versions.join(',')} has licence "${p.license}", which is not on the allowlist (scripts/check-licenses.ts)`,
    );
  }
  if (r.failed.length) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main();
