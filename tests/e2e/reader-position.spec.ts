import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import { addWord, dumpTables, expect, test } from './support/app.ts';
import { SUPABASE_URL } from './support/backend.ts';

// v0.5.1 reader fixes (decision 0054), checked on what the user sees:
//  - tapping a word and closing the reader no longer saves the end of the text ("%90 okudun");
//    a scrolled position is kept and the text reopens there;
//  - a word already in the user's cards shows its meaning at once; new words ask for a guess;
//  - the colour legend shows once; the end of the text sums up its new words and adds several.

const BANK = [
  {
    lemma_norm: 'serendipity',
    pos: 'noun',
    lemma: 'serendipity',
    cefr: 'B1',
    list_source: 'cefrj',
    zipf: 3.1,
    lexicon_term_id: null,
    senses: [{ meaning_tr: 'mutlu tesadüf', example_en: 'Pure serendipity.', example_tr: 'Tesadüf.', sense_id: null }],
    retired: false,
    server_seq: 1,
  },
  {
    lemma_norm: 'meander',
    pos: 'verb',
    lemma: 'meander',
    cefr: 'C1',
    list_source: 'octanove',
    zipf: 2.9,
    lexicon_term_id: null,
    senses: [{ meaning_tr: 'kıvrılarak akmak', example_en: 'Rivers meander.', example_tr: 'Nehirler kıvrılır.', sense_id: null }],
    retired: false,
    server_seq: 2,
  },
];

async function serveBank(page: Page) {
  await page.route(`${SUPABASE_URL}/rest/v1/word_bank**`, async (route: Route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204 });
    const after = Number((new URL(req.url()).searchParams.get('server_seq') ?? 'gt.0').replace('gt.', ''));
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(BANK.filter((r) => r.server_seq > after)),
    });
  });
}

/** A long text: 40 paragraphs, "serendipity" near the top, "meander" in the middle. */
const LONG = Array.from({ length: 40 }, (_, i) =>
  i === 1
    ? 'One day I found serendipity in the park. It made me smile.'
    : i === 20
      ? 'The river began to meander through the valley. We followed it slowly.'
      : `Paragraph ${i + 1}. Every morning I walk my dog in the park. The weather is nice and the trees are green.`,
).join('\n\n');

async function pasteAndOpen(page: Page, title: string, body: string) {
  await page.goto('/add?tab=paste');
  // v0.5.1: Metin ekle › Yapıştır has the box open; "Okuyucuda aç" sits under it.
  await expect(page.getByTestId('open-in-reader')).toBeVisible();
  await page.getByRole('textbox', { name: 'İngilizce metin' }).fill(body);
  await page.getByRole('textbox', { name: 'Başlık' }).fill(title);
  await page.getByRole('button', { name: 'Okuyucuda aç' }).click();
  await expect(page).toHaveURL(/\/oku\/[0-9a-f-]+$/);
  await expect(page.getByTestId('reader-coverage')).toBeVisible();
}

test('reader: closing after a tap keeps the start; a scrolled place is resumed', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await serveBank(page);
  await page.goto('/decks?tab=bank');
  await expect(page.getByTestId('word-bank-row').first()).toBeVisible();
  await pasteAndOpen(page, 'Long walk', LONG);

  // The colour legend shows the first time, and can be closed.
  const legend = page.getByTestId('reader-legend');
  await expect(legend).toContainText('Renklerin anlamı');
  await legend.getByRole('button', { name: 'Renk açıklamasını kapat' }).click();
  await expect(legend).toHaveCount(0);

  // Tap a word near the top, close the sheet, close the reader.
  await page.getByTestId('reader-text').getByText('serendipity', { exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Okuyucuyu kapat' }).click();
  await expect(page).not.toHaveURL(/\/oku\//);
  await page.waitForTimeout(300);
  await page.goto('/decks?tab=reading');
  const row = page.getByTestId('my-texts').getByRole('link', { name: /Long walk/ });
  await expect(row).toContainText('Okunmadı');
  await expect(row).not.toContainText('%9');
  expect(((await dumpTables(page, ['texts'])).texts![0] as { progress_offset: number }).progress_offset).toBe(0);

  // Scroll to the middle, leave, come back: the reader opens there.
  await row.click();
  await expect(page.getByTestId('reader-coverage')).toBeVisible();
  // Shown once: not again on the second opening.
  await expect(page.getByTestId('reader-legend')).toHaveCount(0);
  await page.getByTestId('reader-text').getByText('meander', { exact: true }).scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 200);
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Okuyucuyu kapat' }).click();
  await expect(page).not.toHaveURL(/\/oku\//);
  await page.waitForTimeout(300);
  await page.goto('/decks?tab=reading');
  await expect(row).toContainText(/Okunuyor %(4|5|6)\d/);
  await expect(row).toContainText('Devam et');
  await row.click();
  await expect(page.getByText('Kaldığın yerden')).toBeVisible();
  await expect(page.getByTestId('reader-text').getByText('meander', { exact: true })).toBeInViewport();

  if (process.env.SCREENSHOTS_DIR) {
    await page.screenshot({ path: `${process.env.SCREENSHOTS_DIR}/okuyucu-devam.png` });
  }
});

test('reader: own words show their meaning, new ones ask first; the new words at the end', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await serveBank(page);
  await page.goto('/decks?tab=bank');
  await expect(page.getByTestId('word-bank-row').first()).toBeVisible();
  await addWord(page, { term: 'park', meaning: 'park alanı' });
  await pasteAndOpen(
    page,
    'A walk',
    'One day I found serendipity in the park.\n\nThe river began to meander through the valley.',
  );

  // In the cards: the meaning at once.
  await page.getByTestId('reader-text').getByText('park', { exact: true }).click();
  let sheet = page.getByRole('dialog');
  await expect(sheet.getByText('park alanı')).toBeVisible();
  await expect(sheet.getByTestId('reader-reveal')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // New: guess first.
  await page.getByTestId('reader-text').getByText('serendipity', { exact: true }).click();
  sheet = page.getByRole('dialog');
  await expect(sheet.getByTestId('reader-reveal')).toBeVisible();
  await expect(sheet.getByText('mutlu tesadüf')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // The end of the text: how many new words, then add several at once.
  const summary = page.getByTestId('reader-summary');
  await expect(summary).toContainText(/Bu metinde \d+ yeni kelime gördün · 0 tanesini ekledin/);
  await summary.getByTestId('reader-new-words-open').click();
  const words = page.getByRole('dialog', { name: 'Bu metindeki yeni kelimeler' });
  await expect(words.getByRole('checkbox', { name: /serendipity mutlu tesadüf/ })).toBeChecked();
  await expect(words.getByRole('checkbox', { name: /meander kıvrılarak akmak/ })).toBeChecked();
  await page.waitForTimeout(400);
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
  if (process.env.SCREENSHOTS_DIR) {
    await page.screenshot({ path: `${process.env.SCREENSHOTS_DIR}/yeni-kelimeler.png` });
  }
  await words.getByTestId('reader-new-words-add').click();
  await expect(page.getByText('2 kelime kartlarına eklendi', { exact: true })).toBeVisible();
  await expect(summary).toContainText('· 2 tanesini ekledin');
  const { notes } = await dumpTables(page, ['notes']);
  expect((notes as { term: string }[]).map((n) => n.term).sort()).toEqual(['meander', 'park', 'serendipity']);
});
