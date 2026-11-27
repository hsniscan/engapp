import { addWord, dumpTables, expect, test } from './support/app.ts';
import { serveWordBank, type BankRowSeed } from './support/wordBankSeed.ts';

// 2026-11-26 review #5: a card whose own sentence is a fragment without a translation ("ugly
// face") shows the word bank's example with its Turkish on the back and in the word detail,
// and keeps the user's sentence second as "Senin örneğin". SHOT_DIR=<dir> also saves
// screenshots of both screens at 390 px in light and dark.

const PHONE = { width: 390, height: 844 };
const UGLY: BankRowSeed = {
  lemma_norm: 'ugly',
  pos: 'adjective',
  lemma: 'ugly',
  cefr: 'A2',
  list_source: 'cefrj',
  zipf: 4.5,
  lexicon_term_id: null,
  senses: [
    {
      meaning_tr: 'çirkin',
      example_en: 'They live in an ugly grey building near the station.',
      example_tr: 'İstasyonun yakınındaki çirkin, gri bir binada yaşıyorlar.',
      sense_id: null,
    },
  ],
  retired: false,
  server_seq: 1,
};

test.use({ viewport: PHONE });

test('a weak own sentence gives way to the word bank example (card back, word detail)', async ({ page }) => {
  const shots = process.env.SHOT_DIR;
  await serveWordBank(page, [UGLY]);
  await page.goto('/add');
  await expect
    .poll(async () => (await dumpTables(page, ['word_bank'])).word_bank!.length, { timeout: 20_000 })
    .toBe(1);
  await addWord(page, { term: 'ugly', meaning: 'çirkin', sentence: 'ugly face' });

  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });

    await page.goto('/study?mode=word');
    await page.getByRole('button', { name: 'Cevabı göster', disabled: false }).click();
    const own = page.getByTestId('own-sentence');
    await expect(own).toContainText('Senin örneğin');
    await expect(own).toContainText('ugly face');
    await expect(page.getByTestId('study-back')).toContainText(UGLY.senses[0]!.example_en);
    if (shots) await page.screenshot({ path: `${shots}/5-kart-arkasi-390-${scheme === 'light' ? 'acik' : 'koyu'}.png`, fullPage: true });

    await page.goto('/library');
    await page.getByText('ugly', { exact: true }).first().click();
    const bank = page.getByTestId('bank-example');
    await expect(bank).toContainText(UGLY.senses[0]!.example_tr);
    await expect(page.getByRole('heading', { name: 'Senin örneğin' })).toBeVisible();
    if (shots) {
      await page.getByRole('dialog').evaluate((d) => d.querySelector('[data-testid="bank-example"]')?.scrollIntoView({ block: 'center' }));
      await page.screenshot({ path: `${shots}/5-kelime-detay-390-${scheme === 'light' ? 'acik' : 'koyu'}.png` });
    }
  }
});
