/**
 * v0.3 İP5 "Gelişim" tab: smoke test on the production build with a realistic history
 * (tests/e2e/support/seed.ts, restored through the app), on a 360 px phone.
 */
import { expect, test } from './support/app.ts';
import { restoreSeed } from './support/restore.ts';

test('progress tab: categories, gap practice and the 12-week series on a phone', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/stats');
  await page.getByRole('tab', { name: 'Gelişim' }).click();
  await expect(page).toHaveURL(/\/stats\?tab=gelisim$/);
  await expect(page.getByText(/Henüz sayılacak tekrar yok/)).toBeVisible();

  await restoreSeed(page, 1000);
  await page.goto('/stats?tab=gelisim');
  const groups = page.getByRole('region', { name: 'Kategorilere göre tutma oranı' });
  await expect(groups).toBeVisible();
  await expect(groups.getByText(/Genel tutma oranı/)).toContainText('%');
  await expect(groups.getByRole('listitem', { name: /^Kelime: %\d+, \d+ cevap\./ })).toBeVisible();

  // Another category through the picker.
  await groups.getByRole('combobox', { name: 'Kategori' }).click();
  await page.getByRole('option', { name: 'Kart türü' }).click();
  await expect(groups.getByRole('listitem', { name: /^Tanıma: / })).toBeVisible();

  const series = page.getByRole('region', { name: 'Son 12 hafta' });
  await expect(series.getByRole('img', { name: /öğrenilen kelime sayısı/ })).toBeVisible();
  await expect(series.getByRole('img', { name: /tutma oranı/ })).toBeVisible();
  await series.getByText('Tablo olarak göster').click();
  await expect(series.getByRole('row')).toHaveCount(13);

  // No horizontal scrolling at 360 px.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // The gap list starts a practice round over its notes.
  const gap = page.getByRole('region', { name: 'Tanıma ve üretme' });
  await expect(gap.getByText('Türkçeden İngilizceye', { exact: true })).toBeVisible();
  const start = gap.getByRole('link', { name: /kelimeyle pratik yap$/ });
  if (await start.isVisible()) {
    await start.click();
    await expect(page).toHaveURL(/\/practice\?source=list&size=(10|20)&notes=/);
    await expect(page.getByText('Pratik · takvimin değişmez')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Cevabı göster', disabled: false }),
    ).toBeVisible();
  } else {
    await expect(gap.getByText(/henüz yok/)).toBeVisible();
  }
});
