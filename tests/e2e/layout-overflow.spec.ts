/**
 * Review 2026-11-26 #2, #6, #10: no route scrolls sideways on a phone, also with the largest
 * Android text size (root font 160 %), the tab-bar labels stay on screen, and the (+) is
 * visible on an add page in the light theme.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './support/app.ts';
import { restoreSeed } from './support/restore.ts';

async function sideways(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

async function largeText(page: Page) {
  await page.addInitScript(() => {
    const set = () => document.documentElement.style.setProperty('font-size', '160%');
    set();
    document.addEventListener('DOMContentLoaded', set);
  });
}

test('İlerleme does not scroll sideways at 360 and 390 px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await restoreSeed(page, 300);
  for (const width of [360, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/progress');
    await expect(page.getByRole('img', { name: /Önümüzdeki 30 günün/ })).toBeVisible();
    expect(await sideways(page), `/progress at ${width}`).toBeLessThanOrEqual(0);
  }
});

test('main tabs at 160 % text: no sideways scroll, tab labels inside the screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await restoreSeed(page, 300);
  await largeText(page);
  const nav = page.getByRole('navigation', { name: 'Ana gezinme' });
  for (const url of [
    '/',
    '/decks',
    '/kesfet',
    '/progress',
    '/progress?tab=gelisim',
    '/profile',
    '/add',
  ]) {
    await page.goto(url);
    await expect(nav).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(await sideways(page), url).toBeLessThanOrEqual(0);
  }
  // Every label is fully inside the viewport and inside the bar (nothing cut at the bottom).
  const bar = (await nav.boundingBox())!;
  for (const label of ['Bugün', 'Kelimelerim', 'Ekle', 'Keşfet', 'Profil']) {
    const box = (await nav.getByText(label, { exact: true }).boundingBox())!;
    expect(box.x, label).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, label).toBeLessThanOrEqual(360);
    expect(box.y + box.height, label).toBeLessThanOrEqual(bar.y + bar.height);
  }
});

test('the (+) is visible on an add page in the light theme', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/add');
  const pill = page.getByTestId('nav-add').locator('span').first();
  const [bg, fg] = await pill.evaluate((el) => {
    const s = getComputedStyle(el);
    return [s.backgroundColor, s.color];
  });
  // Contrast of the icon on the pill: well above the 3:1 needed for a graphic.
  const lum = (c: string) => {
    const [r, g, b] = c
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map(Number)
      .map((v) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const [hi, lo] = [lum(bg), lum(fg)].sort((a, b) => b - a);
  expect((hi! + 0.05) / (lo! + 0.05)).toBeGreaterThan(3);
});
