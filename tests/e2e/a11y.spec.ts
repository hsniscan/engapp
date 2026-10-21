/**
 * Accessibility (axe, WCAG 2.2 AA) of every screen with realistic data, phone and desktop,
 * light and dark. With SCREENSHOTS=1 it also writes docs/screenshots/q-<route>-<w>-<theme>.png
 * (the visual QA sweep): `SCREENSHOTS=1 pnpm e2e a11y`.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './support/app.ts';
import { restoreSeed } from './support/restore.ts';
import type { Page } from '@playwright/test';

const SHOTS = !!process.env.SCREENSHOTS;

async function check(page: Page, name: string, tag: string) {
  await page.waitForTimeout(400); // page enter animation, fonts
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const summary = violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.nodes.map((n) => `${n.target.join(' ')} ${n.html.slice(0, 160)} ${n.failureSummary ?? ''}`).join(' | ')}`,
  );
  expect(summary, `${name} ${tag}`).toEqual([]);
  if (SHOTS) {
    // Grow the viewport to the page so fixed bars sit where a user sees them (fullPage
    // screenshots would paint them mid-page).
    const size = page.viewportSize()!;
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewportSize({ width: size.width, height: Math.max(size.height, height) });
    await page.waitForTimeout(150);
    await page.screenshot({ path: `docs/screenshots/q-${name}-${tag}.png` });
    await page.setViewportSize(size);
  }
}

for (const width of [360, 1280]) {
  for (const scheme of ['light', 'dark'] as const) {
    const tag = `${width}-${scheme}`;
    test(`axe: every screen at ${width}px, ${scheme}`, async ({ page }) => {
      test.setTimeout(180_000);
      await page.setViewportSize({ width, height: width < 768 ? 780 : 860 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await restoreSeed(page, 150);

      await page.goto('/');
      await expect(page.getByRole('link', { name: 'Tekrara başla' })).toBeVisible();
      await check(page, 'home', tag);

      await page.goto('/review');
      await expect(
        page.getByRole('button', { name: 'Cevabı göster', disabled: false }),
      ).toBeVisible();
      await check(page, 'review-front', tag);
      await page.locator('body').press('Space');
      await expect(page.getByRole('group', { name: 'Ne kadar iyi hatırladın?' })).toBeVisible();
      await check(page, 'review-back', tag);

      for (const [tab, label] of [
        ['manual', 'Elle'],
        ['paste', 'Metin yapıştır'],
        ['pdf', 'PDF yükle'],
      ] as const) {
        await page.goto(`/add${tab === 'manual' ? '' : `?tab=${tab}`}`);
        await expect(page.getByRole('tab', { name: label, selected: true })).toBeVisible();
        await check(page, `add-${tab}`, tag);
      }

      await page.goto('/library');
      await expect(page.getByRole('list', { name: /./ }).first()).toBeVisible();
      await check(page, 'library', tag);
      // Selected state: the bulk bar must not cover anything that can be tapped.
      await page
        .getByRole('checkbox', { name: /notunu seç$/ })
        .first()
        .check();
      await page
        .getByRole('checkbox', { name: /notunu seç$/ })
        .nth(1)
        .check();
      await expect(page.getByRole('region', { name: 'Seçili notlar için işlemler' })).toContainText(
        '2 not seçili',
      );
      // Keyboard focus on a row under the floating bar scrolls it into the clear.
      const rows = page.getByRole('checkbox', { name: /notunu seç$/ });
      await rows.nth(4).focus();
      const [bar, box] = await Promise.all([
        page.getByRole('region', { name: 'Seçili notlar için işlemler' }).boundingBox(),
        rows.nth(4).boundingBox(),
      ]);
      if (width < 768) expect(box!.y + box!.height).toBeLessThanOrEqual(bar!.y);
      await page.evaluate(() => window.scrollTo(0, 0));
      await check(page, 'library-selected', tag);
      await page
        .getByRole('checkbox', { name: /notunu seç$/ })
        .first()
        .uncheck();
      await page
        .getByRole('checkbox', { name: /notunu seç$/ })
        .nth(1)
        .uncheck();

      await page.goto('/stats');
      await expect(
        page.getByRole('heading', { name: 'İstatistik', level: 1, exact: true }),
      ).toBeVisible();
      await check(page, 'stats', tag);

      await page.goto('/more');
      await expect(
        page.getByRole('heading', { name: 'Biraz daha çalış', level: 1, exact: true }),
      ).toBeVisible();
      await check(page, 'more', tag);
      await page.getByRole('button', { name: 'Pratiğe başla' }).click();
      await expect(page.getByText('Pratik · takvimin değişmez')).toBeVisible();
      await check(page, 'practice-front', tag);
      await page.locator('body').press('Space');
      await expect(page.getByRole('group', { name: 'Bildin mi?' })).toBeVisible();
      await check(page, 'practice-back', tag);

      await page.goto('/settings');
      await expect(
        page.getByRole('heading', { name: 'Ayarlar', level: 1, exact: true }),
      ).toBeVisible();
      await check(page, 'settings', tag);

      await page.goto('/settings/profile');
      const pick = page.getByRole('region', { name: 'İlgi alanların' });
      await pick.getByRole('button', { name: 'Teknoloji' }).click();
      await pick.getByRole('button', { name: 'Bilim' }).click();
      await pick.getByRole('button', { name: 'Seyahat' }).click();
      await page.getByRole('button', { name: 'Seyahat konusunu kapat' }).click();
      await expect(page.getByRole('region', { name: 'Kapalı konular' })).toBeVisible();
      await page.getByText('Nasıl hesaplanır?').click();
      await check(page, 'profile', tag);
    });
  }
}
