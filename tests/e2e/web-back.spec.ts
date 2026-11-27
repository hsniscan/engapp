// 2026-11-26 review, profil-genel #5, #6 and #8 (ADR 0090): browser Back closes an open sheet or
// dialog instead of leaving the page, a tapped tab keeps its underline, and routes have titles.
import type { Page } from '@playwright/test';
import { expect, test } from './support/app.ts';

// A same-page history step fires no load, so page.goBack() would wait for one forever.
const back = (page: Page) => page.evaluate(() => history.back());

test.use({ viewport: { width: 390, height: 844 } });

test('web Back closes the Add sheet and a confirm dialog first, without stray history', async ({
  page,
}) => {
  await page.goto('/settings/veri');
  await page.goto('/profile');
  await expect(page).toHaveTitle('Profil · Engapp');

  // Back with the sheet open: still on Profil, sheet closed; the next Back leaves.
  await page.getByTestId('nav-add').click();
  const sheet = page.getByRole('dialog', { name: 'Ekle' });
  await expect(sheet).toBeVisible();
  await back(page);
  await expect(sheet).toBeHidden();
  await expect(page).toHaveURL(/\/profile$/);

  // A link inside the sheet opens a page; Back returns to Profil, and its old entry is stepped
  // over (checked by the single Back to Ayarlar below).
  await page.getByTestId('nav-add').click();
  await sheet.getByRole('link').first().click();
  await expect(page).not.toHaveURL(/\/profile$/);
  await back(page);
  await expect(page).toHaveURL(/\/profile$/);
  await expect(sheet).toBeHidden();

  // Closed another way (Escape): its entry is gone too, so one Back leaves Profil.
  await page.getByTestId('nav-add').click();
  await expect(sheet).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await back(page);
  await expect(page).toHaveURL(/\/settings\/veri$/);
  await expect(page).toHaveTitle('Yedek ve veri · Engapp');

  // A confirm dialog on a settings page.
  await page.goto('/settings/hesap');
  await page.getByRole('button', { name: 'Verileri sil' }).click();
  const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'));
  await expect(dialog).toBeVisible();
  await back(page);
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/settings\/hesap$/);
});

test('İlerleme: a tapped tab shows its underline, not the focus box; keys still show focus', async ({
  page,
}) => {
  await page.goto('/progress');
  await expect(page).toHaveTitle('İlerleme · Engapp');
  const tab = page.getByRole('tab', { name: 'Gelişim' });
  await tab.click();
  await expect(tab).toHaveAttribute('data-state', 'active');
  await expect(tab).toBeFocused();
  expect(await tab.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('none');
  await page.keyboard.press('ArrowLeft');
  const general = page.getByRole('tab', { name: 'Genel' });
  await expect(general).toBeFocused();
  expect(await general.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
});
