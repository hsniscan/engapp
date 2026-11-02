// v0.5.2 wave 2 (W2): screenshots of every Kelimelerim screen at 390 px, light and dark, with
// realistic seeded data (a restored learner with 40 real words in every stage, two decks, the
// reference Kelime Bankası, a few known words). Runs only with SHOTS_DIR=<dir>; it also checks
// there is no sideways scroll on each screen.
import type { Page } from '@playwright/test';
import { expect, test } from './support/app.ts';
import { restoreSeed } from './support/restore.ts';
import { referenceBankRows, serveWordBank } from './support/wordBankSeed.ts';

const SHOTS = process.env.SHOTS_DIR;
test.skip(!SHOTS, 'screenshots only (SHOTS_DIR)');
test.use({ viewport: { width: 390, height: 844 } });

/** Light and dark of the current screen; full = the whole page. */
async function shot(page: Page, name: string, full = false) {
  const overflow = await page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const wide = [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((el) => el.getBoundingClientRect().right > w + 1)
      .filter((el) => !el.closest('[class*="overflow-x-auto"]'))
      .slice(0, 5)
      .map((el) => `${el.tagName}.${el.className.toString().slice(0, 80)}`);
    return { by: document.documentElement.scrollWidth - w, wide };
  });
  expect(overflow.by, `${name}: sideways scroll ${overflow.wide.join(' | ')}`).toBeLessThanOrEqual(
    0,
  );
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.waitForTimeout(250);
    await page.screenshot({
      path: `${SHOTS}/${name}-${scheme === 'light' ? 'acik' : 'koyu'}.png`,
      fullPage: full,
    });
  }
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
}

async function newDeck(
  page: Page,
  name: string,
  pick: (editor: ReturnType<Page['getByRole']>) => Promise<void>,
) {
  await page.goto('/decks');
  const menu = page.getByRole('button', { name: 'Yeni deste' });
  if (await menu.isVisible()) {
    await menu.click();
    await page.getByRole('menuitem', { name: 'Kurallarla' }).click();
  } else {
    await page.getByRole('button', { name: /Kurallarla/ }).click();
  }
  const editor = page.getByRole('dialog', { name: 'Yeni deste' });
  await editor.getByRole('textbox', { name: 'Adı' }).fill(name);
  await pick(editor);
  return editor;
}

test('W2 screens: Kelimelerim, Tüm kelimelerim, word sheet, decks, tags, Kelime Bankası, known words', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });

  // A first visit: nothing yet, and no word bank to download.
  await page.goto('/decks');
  await expect(page.getByRole('heading', { level: 1, name: 'Kelimelerim' })).toBeVisible();
  await shot(page, '01-kelimelerim-bos', true);
  await page.goto('/decks?tab=bank');
  await expect(
    page.getByRole('heading', { name: 'Kelime Bankası henüz indirilmedi' }),
  ).toBeVisible();
  await shot(page, '02-kelime-bankasi-yuklenemedi');

  await serveWordBank(page, referenceBankRows());
  await restoreSeed(page, 120);

  // Two decks: one by tag (opens the editor), one by stage.
  const editor = await newDeck(page, 'İş kelimeleri', async (e) => {
    await e.getByRole('button', { name: /#iş/ }).click();
  });
  await expect(editor.getByText(/Şu an \d+ kelime bu desteye giriyor\./)).toBeVisible();
  await shot(page, '03-deste-duzenleyici');
  await editor.getByRole('button', { name: 'Oluştur' }).click();
  await expect(page).toHaveURL(/\/decks\/[^/?]+$/);
  await expect(page.getByRole('heading', { level: 1, name: 'İş kelimeleri' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Destedeki kelimeler' })).toBeVisible();
  await shot(page, '04-deste-sayfasi', true);
  const second = await newDeck(page, 'Zorlandıklarım', async (e) => {
    await e.getByRole('button', { name: 'Zorlandıklarım' }).click();
  });
  await second.getByRole('button', { name: 'Oluştur' }).click();
  await expect(page).toHaveURL(/\/decks\/[^/?]+$/);

  // Kelimelerim with words and decks.
  await page.goto('/decks');
  await expect(page.getByRole('list', { name: 'Destelerim' }).getByRole('listitem')).toHaveCount(2);
  await shot(page, '05-kelimelerim', true);
  await page.getByRole('button', { name: 'Yeni deste' }).click();
  await expect(page.getByRole('menuitem', { name: 'Kurallarla' })).toBeVisible();
  await shot(page, '06-yeni-deste-menusu');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Etiketler/ }).click();
  await expect(page.getByRole('dialog', { name: 'Etiketler' })).toBeVisible();
  await shot(page, '07-etiketler');
  await page.keyboard.press('Escape');

  // Tüm kelimelerim: the list, a search with no match, a selection with the bulk bar and tags.
  await page.goto('/library');
  const list = page.getByRole('list', { name: 'Kelimeler' });
  await expect(list.getByRole('listitem').first()).toBeVisible();
  await shot(page, '08-tum-kelimelerim');
  await page.getByRole('searchbox').fill('zzz');
  await expect(page.getByText('Eşleşen kelime yok')).toBeVisible();
  await shot(page, '09-tum-kelimelerim-sonuc-yok');
  await page.getByRole('searchbox').fill('');
  const boxes = list.getByRole('checkbox');
  await boxes.nth(0).click();
  await boxes.nth(2).click();
  await expect(page.getByRole('region', { name: 'Seçili kelimeler için işlemler' })).toBeVisible();
  await shot(page, '10-tum-kelimelerim-secili');
  await page
    .getByRole('region', { name: 'Seçili kelimeler için işlemler' })
    .getByRole('button', { name: 'Etiket' })
    .click();
  await expect(page.getByRole('dialog', { name: 'Etiketler' })).toBeVisible();
  await shot(page, '11-etiket-sayfasi');
  await page.keyboard.press('Escape');
  await boxes.nth(0).click();
  await boxes.nth(2).click();
  await page.getByRole('button', { name: /^Süz($| )/ }).click();
  await expect(page.getByRole('dialog', { name: 'Süz ve sırala' })).toBeVisible();
  await shot(page, '12-suz-ve-sirala');
  await page.keyboard.press('Escape');

  // The word sheet: read view first, then edit.
  await list.getByRole('listitem').first().getByRole('button').first().click();
  const sheet = page.getByRole('dialog').last();
  await expect(sheet.getByRole('button', { name: 'Düzenle' })).toBeVisible();
  await shot(page, '13-kelime-okuma');
  await sheet.getByRole('button', { name: 'Düzenle' }).click();
  await expect(sheet.getByRole('button', { name: 'Kaydet' })).toBeVisible();
  await shot(page, '14-kelime-duzenle');
  await sheet.getByRole('button', { name: 'Vazgeç' }).click();
  await page.keyboard.press('Escape');

  // Kelime Bankası with a row open.
  await page.goto('/decks?tab=bank');
  const bank = page.getByRole('list', { name: 'Kelimeler' });
  await expect(bank.getByTestId('word-bank-row').first()).toBeVisible({ timeout: 30_000 });
  await shot(page, '15-kelime-bankasi');
  await bank.getByTestId('word-bank-row').first().getByRole('button').first().click();
  await shot(page, '16-kelime-bankasi-ayrinti');

  // Keşfet › Desteler and a suggested deck.
  await page.goto('/kesfet?f=desteler');
  await expect(page.getByRole('link', { name: /^B1 kelimeleri/ })).toBeVisible({ timeout: 30_000 });
  await shot(page, '17-kesfet-desteler', true);
  await page.goto('/decks/suggested/level-b1');
  await expect(page.getByRole('heading', { level: 1, name: 'B1 kelimeleri' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Destedeki kelimeler' })).toBeVisible();
  await shot(page, '18-onerilen-deste');
  await page.getByRole('button', { name: /Bildiklerimi işaretle/ }).click();
  await shot(page, '19-onerilen-deste-tarama');

  // Themes (guest: sign-in prompt) and known words.
  await page.goto('/decks/themes');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await shot(page, '20-temalar');
  await page.goto('/settings/bilinen-kelimeler');
  for (const w of ['apple', 'water', 'house', 'because']) {
    await page.getByRole('textbox', { name: 'Bildiğin bir kelimeyi ekle' }).fill(w);
    await page.getByRole('main').getByRole('button', { name: 'Ekle', exact: true }).click();
    await expect(page.getByTestId('known-words').getByText(w, { exact: true })).toBeVisible();
  }
  // Let the four "eklendi" toasts go before the picture.
  await expect(page.getByText('“because” eklendi').first()).toBeHidden({ timeout: 20_000 });
  await shot(page, '21-bilinen-kelimeler');

  // A deck that is not there.
  await page.goto('/decks/nope');
  await expect(page.getByRole('heading', { level: 2, name: 'Deste bulunamadı' })).toBeVisible();
  await shot(page, '22-deste-bulunamadi');
});
