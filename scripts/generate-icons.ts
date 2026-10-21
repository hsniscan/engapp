/**
 * Renders the Engapp mark to the PWA icon set.
 *   node scripts/generate-icons.ts
 * Uses Playwright's Chromium (already a devDependency for e2e tests), so no image library
 * is added. Set CHROMIUM_PATH if the browser is not in Playwright's default location.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { markSvg } from '../src/ui/brand/mark.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(root, 'public');
mkdirSync(join(pub, 'icons'), { recursive: true });

const favicon = markSvg({ tile: 'rounded' });
writeFileSync(join(pub, 'favicon.svg'), favicon + '\n');

const targets: { file: string; size: number; svg: string }[] = [
  { file: 'icons/icon-192.png', size: 192, svg: markSvg({ tile: 'rounded' }) },
  { file: 'icons/icon-512.png', size: 512, svg: markSvg({ tile: 'rounded' }) },
  // Maskable: full-bleed background, glyphs inside the 80 % safe circle.
  { file: 'icons/maskable-512.png', size: 512, svg: markSvg({ tile: 'square', scale: 0.34 }) },
  // iOS applies its own corner mask and ignores transparency.
  {
    file: 'icons/apple-touch-icon-180.png',
    size: 180,
    svg: markSvg({ tile: 'square', scale: 0.4 }),
  },
];

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const { file, size, svg } of targets) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`,
  );
  await page.screenshot({ path: join(pub, file), omitBackground: true });
  console.log('wrote', file);
}
await browser.close();
