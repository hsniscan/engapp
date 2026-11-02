/**
 * Screenshots of the v0.5.2 design preview (ADR 0065) for the owner.
 *   pnpm dev --port 5265 &   then   node scripts/design-preview.ts [baseUrl] [outDir]
 * /dev/preview screens + the /dev/ui gallery, 390 px, light and dark, reduced motion.
 */
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:5265';
const out = process.argv[3] ?? 'docs/screenshots/v052';
mkdirSync(out, { recursive: true });

const shots: [name: string, path: string, fullPage: boolean][] = [
  ['01-bugun', '/dev/preview?screen=today', true],
  ['02-kart-arka', '/dev/preview?screen=card', false],
  ['03-kelimelerim', '/dev/preview?screen=words', true],
  ['04-okuyucu', '/dev/preview?screen=reader', false],
  ['05-galeri', '/dev/ui?embed=1', true],
];

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
for (const theme of ['light', 'dark'] as const) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    colorScheme: theme,
    reducedMotion: 'reduce',
  });
  await ctx.addInitScript((t) => localStorage.setItem('engapp.theme', t), theme);
  const page = await ctx.newPage();
  for (const [name, path, fullPage] of shots) {
    await page.goto(`${base}${path}${path.includes('?') ? '&' : '?'}theme=${theme}`, {
      waitUntil: 'networkidle',
    });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    // No focus ring from a dialog's auto-focus in a still picture.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    if (fullPage) {
      // Grow the viewport to the page so fixed bars sit at the bottom, not mid-page.
      const h = await page.evaluate(() => document.documentElement.scrollHeight);
      await page.setViewportSize({ width: 390, height: Math.max(844, h) });
      await page.waitForTimeout(200);
    }
    const suffix = theme === 'light' ? 'acik' : 'koyu';
    await page.screenshot({ path: `${out}/${name}-390-${suffix}.png` });
    await page.setViewportSize({ width: 390, height: 844 });
  }
  await ctx.close();
}
await browser.close();
console.log(`saved to ${out}`);
