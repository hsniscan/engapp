import { FAKE_SPECS } from '../../src/features/import/testing/fakeSpecs.ts';
import { FakeBackend } from './support/backend.ts';
import { expect, reviewAll, test } from './support/app.ts';

const SPECS = FAKE_SPECS.slice(0, 12);
const TEXT = SPECS.map((s) => s.sentence).join(' ');

test.beforeEach(async ({ context }) => {
  await FakeBackend.signIn(context);
});

// Plan, "Uçtan uca": paste → job → preview → confirm → library → review; acceptance criterion 8.
test('signed in: paste text → saved text + preview (edit, deselect) → cards → review; the same text again makes no AI call', async ({
  page,
  backend,
}) => {
  await page.goto('/add?tab=paste');
  await expect(page.getByText('Hesabına bağlandın', { exact: true })).toBeVisible();

  await page.getByLabel('İngilizce metin').fill(TEXT);
  await page.getByLabel('Başlık').fill('Şehirler ve iklim');
  // v0.5.1: one result for every text; extraction saves the text first and opens the job.
  await expect(page.getByTestId('open-in-reader')).toBeVisible();
  await page.getByRole('button', { name: /Bu metindeki kelimeleri çıkar/ }).click();
  await expect(page).toHaveURL(/\/import\//);
  await expect(page.getByTestId('smart-summary')).toBeVisible();
  expect(backend.count('ai-extract')).toBe(1);
  expect(backend.model.calls).toBe(1);
  // The text the words came from is one tap away.
  await expect(page.getByTestId('read-text')).toHaveText(/Metni oku/);
  // Smart extraction (B1): the four B1 phrases and the two lower words are pre-selected; the
  // B2 words wait unselected in "Senin için"; the three C1/C2 items are only counted.
  await expect(page.getByTestId('smart-summary')).toHaveText(
    'B1 seviyene göre bu metinde 12 aday: senin için 9, kolay 0, zaten bildiğin 0. Seviyenin bir üstünü aşan 3 aday önerilmedi.',
  );
  await expect(page.getByText('6/9 seçili').first()).toBeVisible();

  // Edit a meaning in place, pick a B2 word, deselect one candidate.
  const meaning = page.getByLabel('Türkçe anlamı: reluctant');
  await expect(meaning).toHaveValue('isteksiz');
  await meaning.fill('gönülsüz');
  await meaning.press('Enter');
  await expect(page.getByText('Düzeltildi')).toBeVisible();
  await page.getByRole('checkbox', { name: 'reluctant seç' }).click();
  await page.getByRole('checkbox', { name: 'put off seç' }).click();
  const n = 6;
  await expect(page.getByText(`${n}/9 seçili`).first()).toBeVisible();

  await page.getByRole('button', { name: `${n} kelimeyi ekle` }).click();
  await expect(page).toHaveURL(/\/library/);
  await expect(page.getByText(`${n} kelime eklendi`, { exact: true })).toBeVisible();
  const list = page.getByRole('list', { name: 'Notlar' });
  await expect(list.getByRole('listitem')).toHaveCount(n);
  await expect(list.getByText('gönülsüz')).toBeVisible();
  await expect(list.getByText('put off', { exact: true })).toHaveCount(0);

  // Review the new cards.
  await page.goto('/review');
  expect(await reviewAll(page, '3')).toBeGreaterThan(0);

  // The cards and review logs reach the server.
  await expect
    .poll(() => backend.pushedIds('review_logs').length, { timeout: 20_000 })
    .toBeGreaterThan(0);
  expect(backend.pushedIds('notes')).toHaveLength(n);

  // Same text again: answered from this device's chunk cache, zero ai-extract requests.
  await page.goto('/add?tab=paste');
  await page.getByLabel('İngilizce metin').fill(TEXT);
  await page.getByRole('button', { name: /Bu metindeki kelimeleri çıkar/ }).click();
  await expect(page).toHaveURL(/\/import\//);
  await expect(page.getByTestId('smart-summary')).toBeVisible();
  expect(backend.count('ai-extract')).toBe(1);
  expect(backend.model.calls).toBe(1);
  // Everything already added is in "Biliyorsun", unselected; only "put off" (B1) is new and
  // pre-selected; the B2 words stay unselected.
  await expect(page.getByText('1/9 seçili').first()).toBeVisible();
  await expect(page.getByTestId('smart-summary')).toContainText('zaten bildiğin 6.');
});

test('another device (fresh browser): the same text is answered by the server cache and lexicon, no model call', async ({
  browser,
  page,
  backend,
}) => {
  await page.goto('/add?tab=paste');
  await page.getByLabel('İngilizce metin').fill(TEXT);
  await page.getByRole('button', { name: /Bu metindeki kelimeleri çıkar/ }).click();
  await expect(page.getByTestId('smart-summary')).toBeVisible();
  expect(backend.model.calls).toBe(1);

  // Second device of the same user: empty IndexedDB, same backend.
  const ctx2 = await browser.newContext({ serviceWorkers: 'block', locale: 'tr-TR' });
  await backend.install(ctx2);
  await FakeBackend.signIn(ctx2);
  const page2 = await ctx2.newPage();
  await page2.goto('/add?tab=paste');
  await page2.getByLabel('İngilizce metin').fill(TEXT);
  await page2.getByRole('button', { name: /Bu metindeki kelimeleri çıkar/ }).click();
  await expect(page2.getByTestId('smart-summary')).toBeVisible();
  expect(backend.count('ai-extract')).toBe(2); // the request is made ...
  expect(backend.model.calls).toBe(1); // ... but the model is not called again
  expect(backend.store.senses.size).toBe(SPECS.length); // one lexicon row per sense, no duplicates
  await ctx2.close();
});

test('"Metni oku": the text behind an extraction opens in the reader (v0.5.1)', async ({ page, backend }) => {
  await page.goto('/add?tab=paste');
  await page.getByLabel('İngilizce metin').fill(TEXT);
  await page.getByLabel('Başlık').fill('Şehirler ve iklim');
  await page.getByRole('button', { name: /Bu metindeki kelimeleri çıkar/ }).click();
  await expect(page.getByTestId('smart-summary')).toBeVisible();
  expect(backend.count('ai-extract')).toBe(1);
  await page.getByTestId('read-text').click();
  await expect(page).toHaveURL(/\/oku\//);
  await expect(page.getByRole('heading', { name: 'Şehirler ve iklim' })).toBeVisible();
  await expect(page.getByText(SPECS[0]!.sentence.split(' ').slice(0, 4).join(' '))).toBeVisible();
});
