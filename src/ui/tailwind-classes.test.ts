// @vitest-environment node
/**
 * Guard for design review K-1 (v0.5.1): `@theme { --radius-*: initial; --shadow-*: initial }`
 * made rounded-md/lg/xl and shadow-sm/md compile to NOTHING, silently. This test compiles
 * every rounded-* / shadow-* class used anywhere in src with the real Tailwind theme and fails
 * if one produces no CSS rule. Fix by using a token from the radius/elevation scale in
 * src/index.css (docs/design.md → Radii, Elevation), never by adding a one-off value.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { compile } from 'tailwindcss';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const srcDir = join(root, 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

// A class token: optional variants (md:, hover:, data-[x]:), then rounded… / shadow…, not an
// arbitrary value ([..] / (..)), not part of a longer identifier or a CSS variable name.
const CLASS_RE =
  /(?<![\w$.\-/[(])(?:[a-z0-9-]+(?:\[[^\]\s]*\])?:)*((?:rounded|shadow)(?:-[a-z0-9]+)*)(?![\w\-[(/:])/g;

async function compiler() {
  const entry = join(srcDir, 'index.css');
  return compile(readFileSync(entry, 'utf8'), {
    base: dirname(entry),
    async loadStylesheet(id: string, base: string) {
      const path =
        id === 'tailwindcss' ? join(root, 'node_modules/tailwindcss/index.css') : resolve(base, id);
      return { path, base: dirname(path), content: readFileSync(path, 'utf8') };
    },
  });
}

function escapeClass(c: string): string {
  return c.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}

describe('Tailwind radius/shadow classes', () => {
  it('every rounded-* and shadow-* class used in src compiles to a rule', async () => {
    const used = new Map<string, string>();
    for (const file of walk(srcDir)) {
      if (file.endsWith('.css')) continue;
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(CLASS_RE)) {
        const cls = m[1]!;
        if (!used.has(cls)) used.set(cls, file.slice(root.length + 1));
      }
    }
    expect(used.size).toBeGreaterThan(5);
    const c = await compiler();
    const dead: string[] = [];
    for (const [cls, file] of used) {
      const css = c.build([cls]);
      if (!css.includes(`.${escapeClass(cls)}`)) dead.push(`${cls} (${file})`);
    }
    expect(dead).toEqual([]);
  });

  it('the guard itself catches a dead class', async () => {
    const c = await compiler();
    expect(c.build(['rounded-foo'])).not.toContain('.rounded-foo');
    expect(c.build(['rounded-t-lg'])).toContain('.rounded-t-lg');
    expect(c.build(['shadow-md'])).toContain('.shadow-md');
  });
});
