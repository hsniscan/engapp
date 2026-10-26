import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import { dumpTables, expect, test } from './support/app.ts';
import { SUPABASE_URL } from './support/backend.ts';

// v0.5 İP1 reader (decision 0043): a guest pastes a text with the network off, it opens in the
// reader, a tapped word shows "Tahmin et" and then its meaning from Kelime Bankası (downloaded
// earlier, so offline), and "Karta ekle" makes a card whose source sentence is the text's.

const BANK = [
  {
    lemma_norm: 'serendipity',
    pos: 'noun',
    lemma: 'serendipity',
    cefr: 'B1',
    list_source: 'cefrj',
    zipf: 3.1,
    lexicon_term_id: null,
    senses: [
      {
        meaning_tr: 'mutlu tesadüf',
        example_en: 'It was pure serendipity.',
        example_tr: 'Tamamen mutlu bir tesadüftü.',
        sense_id: null,
      },
    ],
    retired: false,
    server_seq: 1,
  },
];

async function axe(page: Page, name: string) {
  await page.waitForTimeout(400);
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
    name,
  ).toEqual([]);
  // SCREENSHOTS=1: pictures for the design review (docs/screenshots, like a11y.spec.ts).
  if (process.env.SCREENSHOTS) {
    await page.screenshot({ path: `docs/screenshots/r-${name.replace(/\s+/g, '-')}.png` });
  }
}

async function serveBank(page: Page) {
  await page.route(`${SUPABASE_URL}/rest/v1/word_bank**`, async (route: Route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204 });
    const after = Number(
      (new URL(req.url()).searchParams.get('server_seq') ?? 'gt.0').replace('gt.', ''),
    );
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(BANK.filter((r) => r.server_seq > after)),
    });
  });
}

const TEXT =
  'Every morning I walk my dog in the park.\n\nOne day I found serendipity in the park. It made me smile.';

test('reader: paste offline, tap a word, guess, see the meaning, add a card', async ({
  page,
  context,
}) => {
  await serveBank(page);
  // Online once: Kelime Bankası downloads. The paste screen fetches the reader's code.
  await page.goto('/decks?tab=bank');
  await expect(page.getByTestId('word-bank-row').first()).toBeVisible();
  await page.goto('/add?tab=paste');
  // v0.5.1: the paste box is open for guests; only extraction asks for sign-in.
  await expect(page.getByTestId('open-in-reader')).toBeVisible();
  await page.waitForLoadState('networkidle');

  await context.setOffline(true);
  await page.getByRole('textbox', { name: 'İngilizce metin' }).fill(TEXT);
  await page.getByRole('textbox', { name: 'Başlık' }).fill('A walk');
  await page.getByRole('button', { name: 'Okuyucuda aç' }).click();

  await expect(page).toHaveURL(/\/oku\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name: 'A walk' })).toBeVisible();
  await expect(page.getByTestId('reader-coverage')).toContainText('biliyorsun');

  await page.getByTestId('reader-text').getByText('serendipity', { exact: true }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByText(/Önce cümleye bak/)).toBeVisible();
  await expect(sheet.getByText('mutlu tesadüf')).toHaveCount(0);
  await sheet.getByTestId('reader-reveal').click();
  await expect(sheet.getByText('mutlu tesadüf')).toBeVisible();
  await sheet.getByTestId('reader-add-card').click();
  await expect(sheet.getByText('Bu kelime kartlarında var.')).toBeVisible();

  const { notes, senses, texts } = await dumpTables(page, ['notes', 'senses', 'texts']);
  expect(notes).toEqual([expect.objectContaining({ term: 'serendipity' })]);
  expect(senses).toEqual([
    expect.objectContaining({
      meaning_tr: 'mutlu tesadüf',
      source_sentence: 'One day I found serendipity in the park.',
    }),
  ]);
  expect(texts).toEqual([expect.objectContaining({ title: 'A walk', kind: 'paste', body: TEXT })]);
  await context.setOffline(false);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`axe: the reader, its word sheet and Okuma at 360px, ${scheme}`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await serveBank(page);
    await page.goto('/decks?tab=bank');
    await expect(page.getByTestId('word-bank-row').first()).toBeVisible();
    await page.goto('/add?tab=paste');
    await page.getByRole('textbox', { name: 'İngilizce metin' }).fill(TEXT);
    await page.getByRole('button', { name: 'Okuyucuda aç' }).click();
    await expect(page.getByTestId('reader-coverage')).toBeVisible();
    await axe(page, `reader ${scheme}`);
    await page.getByTestId('reader-text').getByText('serendipity', { exact: true }).click();
    await page.getByRole('dialog').getByTestId('reader-reveal').click();
    await axe(page, `word sheet ${scheme}`);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Okuma ayarları' }).click();
    await expect(page.getByRole('dialog', { name: 'Okuma ayarları' })).toBeVisible();
    await axe(page, `reader options ${scheme}`);
    await page.keyboard.press('Escape');
    await page.goto('/kesfet?f=okuma');
    await expect(page.getByTestId('my-texts')).toBeVisible();
    await axe(page, `okuma tab ${scheme}`);
  });
}
