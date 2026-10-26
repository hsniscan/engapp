import { readFile } from 'node:fs/promises';
import { addWord, dumpTables, expect, test, WORDS } from './support/app.ts';

const TABLES = ['notes', 'senses', 'cards', 'review_logs', 'daily_activity', 'sources'];

// Acceptance criterion 6: a JSON backup restored into an empty browser gives identical cards,
// review history and streak.
test('backup → restore into an empty browser: notes, cards, review history and streak identical', async ({
  page,
  browser,
}, info) => {
  for (const w of WORDS) await addWord(page, w);
  await page.goto('/review');
  // Mixed answers so that the history is not trivial.
  const ratings = ['3', '1', '4', '2', '3', '3', '4', '3', '3', '3', '3', '3', '3', '3'];
  for (let i = 0; ; i++) {
    const show = page.getByRole('button', { name: 'Cevabı göster', disabled: false });
    const summary = page.getByRole('heading', { name: 'Oturum tamamlandı' });
    await expect(show.or(summary)).toBeVisible();
    if (await summary.isVisible()) break;
    await page.locator('body').press('Space');
    await page.locator('body').press(ratings[i % ratings.length]!);
  }
  await page.goto('/');
  await expect(page.getByTestId('today-streak')).toBeVisible();
  const homeBefore = await page.getByTestId('today-streak').textContent();
  const before = await dumpTables(page, TABLES);
  expect(before.review_logs!.length).toBeGreaterThan(WORDS.length);

  await page.goto('/settings/veri');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Yedek al' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^engapp-yedek-\d{4}-\d{2}-\d{2}\.json$/);
  const path = info.outputPath('backup.json');
  await file.saveAs(path);
  const json = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  expect(json).toHaveProperty('checksum');

  // A fresh browser profile: empty IndexedDB.
  const ctx = await browser.newContext({
    serviceWorkers: 'block',
    locale: 'tr-TR',
    timezoneId: 'Europe/Istanbul',
  });
  const fresh = await ctx.newPage();
  await fresh.goto('/');
  await expect(fresh.getByRole('heading', { name: 'Hoş geldin' })).toBeVisible();
  await fresh.goto('/settings/veri');
  await expect(fresh.getByText('Henüz yedek alınmadı')).toBeVisible();
  const chooser = fresh.waitForEvent('filechooser');
  await fresh.getByRole('button', { name: 'Geri yükle' }).click();
  // As a buffer: Playwright does not deliver files from paths with non-ASCII characters
  // (the test's output folder contains "→").
  await (
    await chooser
  ).setFiles({
    name: file.suggestedFilename(),
    mimeType: 'application/json',
    buffer: await readFile(path),
  });
  const dialog = fresh.getByRole('dialog', { name: 'Yedeği geri yükle' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Üzerine yaz' }).click();
  await expect(fresh.getByText('Geri yükleme tamamlandı', { exact: true })).toBeVisible();

  const after = await dumpTables(fresh, TABLES);
  for (const t of TABLES) expect(after[t], t).toEqual(before[t]);
  await fresh.goto('/');
  await expect(fresh.getByTestId('today-streak')).toHaveText(homeBefore!);
  await ctx.close();
});
