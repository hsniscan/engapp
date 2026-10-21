/**
 * Visual + accessibility QA for the design system.
 *   pnpm dev --port 5199 &   then   node scripts/ui-qa.ts [baseUrl] [outDir]
 * Takes screenshots of /dev/ui and the shell at 360 px and 1280 px in light and dark
 * (reduced motion, for stable frames) and runs axe (WCAG 2.2 A/AA + best practices).
 * Set CHROMIUM_PATH to use a preinstalled Chromium. Exits 1 on any axe violation.
 */
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

const base = process.argv[2] ?? 'http://localhost:5199';
const out = process.argv[3] ?? 'docs/screenshots';
mkdirSync(out, { recursive: true });

const pages: [name: string, path: string, fullPage: boolean][] = [
  ['gallery', '/dev/ui', true],
  ['home', '/', false],
  ['review', '/review', false],
  ['library', '/library', false],
  ['settings', '/settings', false],
];
const axePaths = [
  '/dev/ui',
  '/dev/ui?flipped=1',
  '/dev/ui?open=dialog',
  '/',
  '/review',
  '/library',
  '/settings',
  '/auth',
];

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
let violations = 0;
for (const theme of ['light', 'dark'] as const) {
  for (const width of [360, 1280]) {
    const ctx = await browser.newContext({
      viewport: { width, height: width === 360 ? 780 : 860 },
      deviceScaleFactor: width === 360 ? 2 : 1,
      colorScheme: theme,
      reducedMotion: 'reduce',
    });
    await ctx.addInitScript((t) => localStorage.setItem('engapp.theme', t), theme);
    const page = await ctx.newPage();
    for (const [name, path, fullPage] of pages) {
      await page.goto(base + path, { waitUntil: 'networkidle' });
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${out}/${name}-${width}-${theme}.png`, fullPage });
      if (name === 'review') {
        await page.getByRole('button', { name: /Cevabı göster|Show answer/ }).click();
        await page.waitForTimeout(400);
        await page.screenshot({ path: `${out}/review-flipped-${width}-${theme}.png` });
      }
    }
    for (const path of axePaths) {
      await page.goto(base + path, { waitUntil: 'networkidle' });
      await page.waitForTimeout(300);
      const result = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
        .analyze();
      for (const v of result.violations) {
        violations++;
        console.log(`[${theme} ${width}] ${path} ${v.id}: ${v.help}`);
        for (const n of v.nodes.slice(0, 3)) console.log('   ', n.target.join(' '));
      }
    }
    await ctx.close();
  }
}
await browser.close();
console.log(`axe violations: ${violations}`);
process.exit(violations ? 1 : 0);
