/**
 * Accessibility (axe, WCAG 2.2 AA) of the İP8 screens with realistic data: Desteler
 * (Destelerim, Keşfet), a deck's own page, the rules editor, Tüm kelimelerim with the bulk bar,
 * the tag sheet and the theme preview, at phone and desktop width, light and dark. With SHOTS_DIR=<dir> it also writes
 * screenshots there (kept out of docs/screenshots on purpose).
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './support/app.ts';
import { restoreSeed } from './support/restore.ts';

const SHOTS = process.env.SHOTS_DIR;

async function check(page: Page, name: string, tag: string) {
  await page.waitForTimeout(400);
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const summary = violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.nodes.map((n) => `${n.target.join(' ')} ${n.html.slice(0, 160)}`).join(' | ')}`,
  );
  expect(summary, `${name} ${tag}`).toEqual([]);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/decks-${name}-${tag}.png` });
}

/** A pending theme preview over the first live notes (the AI step itself is in decks.spec). */
async function seedThemePreview(page: Page) {
  await page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open('engapp');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const notes: { id: string; deleted_at: number | null; created_at: number }[] =
      await new Promise((res) => {
        const req = db.transaction('notes').objectStore('notes').getAll();
        req.onsuccess = () => res(req.result);
      });
    const ids = notes
      .filter((n) => n.deleted_at === null)
      .sort((a, b) => b.created_at - a.created_at)
      .map((n) => n.id);
    const group = (key: string, name: string, from: number, n: number, extra = {}) => ({
      key,
      suggested: name,
      name,
      note_ids: ids.slice(from, from + n),
      removed: [],
      rejected: false,
      ...extra,
    });
    const tx = db.transaction('theme_previews', 'readwrite');
    tx.objectStore('theme_previews').put({
      id: 'current',
      created_at: Date.now(),
      model: 'fake-model',
      sent: 40,
      groups: [
        group('ekonomi', 'Ekonomi ve para', 0, 9),
        group('değişim', 'Değişim ve gelişme', 9, 6),
        group('duygular', 'Duygular', 15, 4, { rejected: true }),
      ],
    });
    await new Promise((res) => (tx.oncomplete = res));
    db.close();
  });
}

for (const width of [360, 1280]) {
  for (const scheme of ['light', 'dark'] as const) {
    const tag = `${width}-${scheme}`;
    test(`axe: decks, tags and themes at ${width}px, ${scheme}`, async ({ page }) => {
      test.setTimeout(180_000);
      await page.setViewportSize({ width, height: width < 768 ? 780 : 860 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await restoreSeed(page, 150);

      // Desteler, no decks yet, then the rules editor ("Yeni deste · Kurallarla").
      await page.goto('/decks');
      await page.getByRole('button', { name: /Kurallarla/ }).click();
      const editor = page.getByRole('dialog', { name: 'Yeni deste' });
      await editor.getByRole('textbox', { name: 'Adı' }).fill('İş · zorlandıklarım');
      await editor.getByRole('button', { name: /#iş/ }).click();
      await editor.getByRole('button', { name: 'Zorlandıklarım' }).click();
      await editor.getByRole('button', { name: 'Öğreniliyor' }).click();
      await expect(editor.getByText(/Şu an \d+ kelime bu desteye giriyor\./)).toBeVisible();
      await check(page, 'editor', tag);
      await editor.getByRole('button', { name: 'Oluştur' }).click();
      // Saving opens the deck's own page.
      await expect(page).toHaveURL(/\/decks\/[^/?]+$/);
      const deckId = new URL(page.url()).pathname.split('/').pop()!;
      await expect(
        page.getByRole('heading', { level: 1, name: 'İş · zorlandıklarım' }),
      ).toBeVisible();
      await check(page, 'deck-detail', tag);
      await page.goto('/decks');
      await page.getByRole('button', { name: /Kurallarla/ }).click();
      await editor.getByRole('textbox', { name: 'Adı' }).fill('Bu hafta eklediklerim');
      await editor.getByText('Son 7 gün', { exact: true }).click();
      await editor.getByRole('button', { name: 'Oluştur' }).click();
      await expect(page).toHaveURL(/\/decks\/[^/?]+$/);
      await page.goto('/decks');
      await expect(
        page.getByRole('list', { name: 'Destelerim' }).getByRole('listitem'),
      ).toHaveCount(2);
      await check(page, 'decks', tag);
      // Keşfet before the word bank is downloaded.
      await page.goto('/decks?tab=discover');
      await expect(page.getByRole('link', { name: 'Keşfet', exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      );
      await check(page, 'decks-discover', tag);

      // Tüm kelimelerim: one deck's words, then a selection with the bulk bar and the tag sheet.
      await page.goto(`/library?deck=${deckId}`);
      await expect(page.getByRole('link', { name: 'Desteyi aç' })).toBeVisible();
      await check(page, 'library-deck', tag);
      await page.goto('/library');
      const boxes = page.getByRole('list', { name: 'Notlar' }).getByRole('checkbox');
      for (let i = 0; i < 3; i++) await boxes.nth(i).click();
      await expect(page.getByRole('region', { name: 'Seçili notlar için işlemler' })).toBeVisible();
      await check(page, 'library-bulk', tag);
      await page
        .getByRole('region', { name: 'Seçili notlar için işlemler' })
        .getByRole('button', { name: 'Etiket' })
        .click();
      const sheet = page.getByRole('dialog', { name: 'Etiketler' });
      await sheet.getByRole('textbox').fill('okul');
      await sheet.getByRole('textbox').press('Enter');
      await check(page, 'tag-sheet', tag);
      await sheet.getByRole('button', { name: 'Uygula' }).click();

      // Themes: start (guest: sign-in prompt), then a pending preview.
      await page.goto('/decks/themes');
      await expect(
        page.getByText('Tema gruplama AI kullanır; Google ile giriş yapınca açılır.'),
      ).toBeVisible();
      await check(page, 'themes-start', tag);
      await seedThemePreview(page);
      await page.reload();
      await expect(page.getByRole('list', { name: 'Önerilen temalar' })).toBeVisible();
      await page
        .getByRole('region', { name: /Ekonomi ve para/ })
        .getByRole('button')
        .nth(1)
        .click();
      await check(page, 'themes-preview', tag);
    });
  }
}
