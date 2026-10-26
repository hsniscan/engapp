// "Engapp" in the text-selection menu (v0.5 İP4, decision 0046): the /quick sheet in the web
// build at phone width. On Android QuickCaptureActivity opens the same route with the selection
// (src/native/quick.ts); here the address is opened directly.
import type { Page } from '@playwright/test';
import { dumpTables, expect, test } from './support/app.ts';
import { SUPABASE_URL } from './support/backend.ts';
import { serveWordBank, type BankRowSeed } from './support/wordBankSeed.ts';

test.use({ viewport: { width: 360, height: 740 } });

const row = (lemma: string, cefr: string, meaning: string, seq: number): BankRowSeed => ({
  lemma_norm: lemma,
  pos: 'noun',
  lemma,
  cefr,
  list_source: cefr.startsWith('C') ? 'octanove' : 'cefrj',
  zipf: 3,
  lexicon_term_id: null,
  senses: [
    {
      meaning_tr: meaning,
      example_en: `It was pure ${lemma}.`,
      example_tr: `Tamamen ${meaning} idi.`,
      sense_id: null,
    },
  ],
  retired: false,
  server_seq: seq,
});

const BANK = [
  row('serendipity', 'C1', 'mutlu tesadüf', 1),
  row('opinion', 'B1', 'görüş', 2),
  row('journey', 'B1', 'yolculuk', 3),
];

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('offline', () => {
  // The service worker serves the app and the lazy /quick chunk without the network.
  test.use({ serviceWorkers: 'allow' });

  test('/quick?text=serendipity offline: the word bank meaning, one tap to a card, then back', async ({
    page,
    context,
  }) => {
    await serveWordBank(page, BANK);
    await page.goto('/');
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload(); // controlled by the worker from here on

    // The bank is downloaded once (Desteler → Kelime bankası), as on any device.
    await page.goto('/decks?tab=bank');
    await expect(page.getByTestId('word-bank-row').first()).toBeVisible();

    // Airplane mode: nothing may leave the device from here on.
    const outside: string[] = [];
    page.on('request', (r) => {
      if (!r.url().startsWith('http://localhost')) outside.push(r.url());
    });
    await context.setOffline(true);

    const started = Date.now();
    await page.goto('/quick?text=serendipity');
    const sheet = page.getByRole('dialog', { name: 'serendipity' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText('mutlu tesadüf')).toBeVisible();
    console.log(`/quick offline: sheet with meaning in ${Date.now() - started} ms`);
    await expect(sheet.getByText('C1')).toBeVisible();
    await expect(sheet.getByTestId('quick-sense').first()).toHaveAttribute('aria-pressed', 'true');
    // Only the sheet: no tab bar, no top bar.
    await expect(page.getByRole('navigation')).toHaveCount(0);
    await noSideScroll(page);

    await sheet.getByRole('button', { name: 'Karta ekle' }).click();
    await expect(page.getByTestId('quick-saved')).toContainText('“serendipity” kartlarına eklendi');
    // The short confirmation, then back where the user was.
    await expect(page).toHaveURL(/\/decks\?tab=bank$/);

    const { notes, senses } = await dumpTables(page, ['notes', 'senses']);
    expect((notes as { term: string }[]).map((n) => n.term)).toEqual(['serendipity']);
    expect((senses as { meaning_tr: string }[]).map((s) => s.meaning_tr)).toEqual([
      'mutlu tesadüf',
    ]);
    expect(outside.filter((u) => u.startsWith(SUPABASE_URL))).toEqual([]);
  });
});

test('an inflected word finds its base form; the second time it says the card exists', async ({
  page,
}) => {
  await serveWordBank(page, BANK);
  await page.goto('/decks?tab=bank');
  await expect(page.getByTestId('word-bank-row').first()).toBeVisible();

  await page.goto('/quick?text=%E2%80%9COpinions.%E2%80%9D');
  const sheet = page.getByRole('dialog', { name: 'opinion' });
  await expect(sheet.getByText('Seçtiğin: Opinions')).toBeVisible();
  await sheet.getByRole('button', { name: 'Karta ekle' }).click();
  await expect(page.getByTestId('quick-saved')).toBeVisible();
  await expect(page).toHaveURL(/\/decks\?tab=bank$/);

  await page.goto('/quick?text=opinion');
  await expect(
    page.getByRole('dialog', { name: 'opinion' }).getByText('Kartlarında var'),
  ).toBeVisible();
});

test('a long selection: "Okuyucuda aç" saves it as a reading text', async ({ page }) => {
  const text = 'The committee reluctantly postponed the decision until the spring.';
  await page.goto(`/quick?text=${encodeURIComponent(text)}`);
  const sheet = page.getByRole('dialog', { name: 'Seçtiğin metin' });
  await expect(sheet.getByTestId('quick-text')).toHaveText(text);
  await expect(sheet.getByText('10 kelime')).toBeVisible();
  await noSideScroll(page);
  await sheet.getByTestId('quick-reader').click();
  await expect(page).toHaveURL(/\/oku\/[0-9a-f-]{36}$/);
  const { texts } = await dumpTables(page, ['texts']);
  expect(texts).toEqual([expect.objectContaining({ kind: 'paste', body: text })]);
});

test('a long selection: "Kelimeleri çıkar" opens the extraction preview', async ({ page }) => {
  const text = 'The committee reluctantly postponed the decision until the spring.';
  await page.goto(`/quick?text=${encodeURIComponent(text)}`);
  await page.getByTestId('quick-extract').click();
  await expect(page.getByRole('heading', { name: 'Metinden kelime çıkar' })).toBeVisible();
  await expect(page.getByTestId('shared-text')).toHaveText(text);
});

test('an unknown word for a guest: invited to sign in or write the meaning', async ({ page }) => {
  await page.goto('/quick?text=flibbertigibbet');
  const sheet = page.getByRole('dialog', { name: 'flibbertigibbet' });
  await expect(sheet.getByText(/Anlamını bulmak için giriş yap/)).toBeVisible();
  await sheet.getByRole('button', { name: 'Anlamını kendim yazayım' }).click();
  await expect(page).toHaveURL(/\/add\?term=flibbertigibbet$/);
  await expect(page.getByLabel('İngilizce kelime ya da kalıp')).toHaveValue('flibbertigibbet');
});
