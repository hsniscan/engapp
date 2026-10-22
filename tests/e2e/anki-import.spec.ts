/**
 * Anki import (v0.3 İP1, acceptance criterion 8) with the committed fixture packages
 * (tests/fixtures/anki/, built by scripts/anki-fixtures.ts): read in the worker, summary,
 * SM-2 warning, field mapping with a 3-note preview, import with history, no duplicates on a
 * second import, and the screen's accessibility at phone width in both themes.
 */
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { dumpTables, expect, test } from './support/app.ts';
import type { Page } from '@playwright/test';

const fixture = (format: string) => readFileSync(new URL(`../fixtures/anki/sample-${format}.apkg`, import.meta.url));

async function pick(page: Page, name: string, buffer: Buffer) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Anki dosyası seç' }).click();
  await (await chooser).setFiles({ name, mimeType: 'application/octet-stream', buffer });
}

async function axe(page: Page, label: string) {
  await page.waitForTimeout(300);
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
    label,
  ).toEqual([]);
}

test('guest imports an Anki deck with its history; a second import adds nothing', async ({ page }) => {
  await page.goto('/add');
  await page.getByRole('link', { name: 'Anki dosyası (.apkg) yükle' }).click();
  await expect(page).toHaveURL(/\/import\/anki$/);
  await expect(page.getByRole('heading', { name: "Anki'den taşı", level: 1 })).toBeVisible();

  await pick(page, 'ingilizce.apkg', fixture('anki21b'));
  await expect(page.getByTestId('anki-summary')).toHaveText('7 not, 13 kart, 18 tekrar kaydı');
  await expect(page.getByText('Tekrar aralıkları yeniden hesaplanacak')).toBeVisible();
  await expect(page.getByText('Boşluk doldurma (cloze) notları aktarılmaz: 1 not.')).toBeVisible();
  const preview = page.getByTestId('anki-preview');
  await expect(preview.getByRole('listitem')).toHaveCount(3);
  await expect(preview.getByRole('listitem').first()).toContainText('reluctant — isteksiz, gönülsüz');
  await expect(preview.getByRole('listitem').first()).toContainText('She was reluctant to leave.');
  await expect(preview.getByRole('listitem').nth(1)).toContainText('give up — vazgeçmek; bırakmak');

  // Swapping the fields changes the preview; choosing the same field twice is refused.
  await page.getByRole('combobox', { name: 'Türkçe anlam' }).click();
  await page.getByRole('option', { name: 'Front' }).click();
  await expect(page.getByText('İngilizce kelime, Türkçe anlam ve örnek cümle için farklı alanlar seç.')).toBeVisible();
  await expect(page.getByRole('button', { name: '6 notu aktar' })).toBeDisabled();
  await page.getByRole('combobox', { name: 'Türkçe anlam' }).click();
  await page.getByRole('option', { name: 'Back' }).click();

  await page.getByRole('button', { name: '6 notu aktar' }).click();
  const result = page.getByTestId('anki-result');
  await expect(result).toContainText('5 yeni kelime eklendi');
  await expect(result).toContainText('16 tekrar kaydı geçmişine eklendi');
  await expect(result).toContainText("2 kart Anki'deki gibi askıda");
  await expect(result).toContainText('2 ses veya resim atlandı');
  // Guests can still use the cards; dictionary matching needs an account.
  await expect(page.getByText('Sözlükle eşleştirmek için Google ile giriş yap.', { exact: false })).toBeVisible();

  const tables = await dumpTables(page, ['notes', 'cards', 'review_logs', 'sources']);
  expect(tables.notes).toHaveLength(5);
  expect(tables.cards).toHaveLength(14);
  expect(tables.review_logs).toHaveLength(16);
  expect((tables.review_logs as { origin?: string }[]).every((l) => l.origin === 'anki')).toBe(true);
  expect(tables.sources).toEqual([expect.objectContaining({ kind: 'anki', title: 'ingilizce' })]);

  // The same file again (in the old format this time): nothing new.
  await page.getByRole('button', { name: 'Başka dosya aktar' }).click();
  await pick(page, 'ingilizce.apkg', fixture('anki2'));
  await page.getByRole('button', { name: '6 notu aktar' }).click();
  await expect(page.getByTestId('anki-result')).toContainText('5 kelime zaten vardı, değişmedi');
  const again = await dumpTables(page, ['notes', 'cards', 'review_logs', 'sources']);
  expect([again.notes, again.cards, again.review_logs, again.sources].map((t) => t!.length)).toEqual([5, 14, 16, 1]);

  // The imported words are in the library and studied ones are not new.
  await page.getByRole('link', { name: 'Kartlarıma git' }).click();
  await expect(page.getByText('reluctant', { exact: true })).toBeVisible();
  await expect(page.getByText('thorough', { exact: true })).toBeVisible();
});

for (const format of ['anki2', 'anki21'] as const) {
  test(`reads the ${format} format`, async ({ page }) => {
    await page.goto('/import/anki');
    await pick(page, `deste-${format}.apkg`, fixture(format));
    await expect(page.getByTestId('anki-summary')).toHaveText('7 not, 13 kart, 18 tekrar kaydı');
  });
}

test('a file that is not an Anki package gets a clear message', async ({ page }) => {
  await page.goto('/import/anki');
  await pick(page, 'notlar.apkg', Buffer.from('just some text'));
  await expect(page.getByRole('alert')).toContainText("Bu bir Anki dosyası değil.");
});

for (const scheme of ['light', 'dark'] as const) {
  test(`axe: Anki import at 360px, ${scheme}`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.goto('/import/anki');
    await expect(page.getByRole('button', { name: 'Anki dosyası seç' })).toBeVisible();
    await axe(page, `pick ${scheme}`);
    await pick(page, 'ingilizce.apkg', fixture('anki21b'));
    await expect(page.getByTestId('anki-preview')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    await axe(page, `review ${scheme}`);
    await page.getByRole('button', { name: '6 notu aktar' }).click();
    await expect(page.getByTestId('anki-result')).toBeVisible();
    await axe(page, `done ${scheme}`);
  });
}
