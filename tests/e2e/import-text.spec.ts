import { FAKE_SPECS } from '../../src/features/import/testing/fakeSpecs.ts';
import { FakeBackend } from './support/backend.ts';
import { expect, reviewAll, test } from './support/app.ts';

const SPECS = FAKE_SPECS.slice(0, 12);
const TEXT = SPECS.map((s) => s.sentence).join(' ');

test.beforeEach(async ({ context }) => {
  await FakeBackend.signIn(context);
});

// Plan, "Uçtan uca": paste → job → preview → confirm → library → review; acceptance criterion 8.
test('signed in: paste text → preview (edit, deselect) → cards → review; the same text again makes no AI call', async ({
  page,
  backend,
}) => {
  await page.goto('/add?tab=paste');
  await expect(page.getByText('Hesabına bağlandın', { exact: true })).toBeVisible();

  await page.getByLabel('İngilizce metin').fill(TEXT);
  await page.getByLabel('Başlık').fill('Şehirler ve iklim');
  await page.getByRole('button', { name: 'Kelimeleri çıkar' }).click();
  await expect(page.getByText('Adaylar hazır')).toBeVisible();
  expect(backend.count('ai-extract')).toBe(1);
  expect(backend.model.calls).toBe(1);

  await page.getByRole('link', { name: 'Önizlemeyi aç' }).click();
  await expect(page).toHaveURL(/\/import\//);
  await expect(page.getByText(`${SPECS.length}/${SPECS.length} seçili`).first()).toBeVisible();

  // Edit a meaning in place, deselect one candidate.
  const meaning = page.getByLabel('Türkçe anlamı: reluctant');
  await expect(meaning).toHaveValue('isteksiz');
  await meaning.fill('gönülsüz');
  await meaning.press('Enter');
  await expect(page.getByText('Düzeltildi')).toBeVisible();
  await page.getByRole('checkbox', { name: 'cope seç' }).click();
  const n = SPECS.length - 1;
  await expect(page.getByText(`${n}/${SPECS.length} seçili`).first()).toBeVisible();

  await page.getByRole('button', { name: `${n} kelimeyi ekle` }).click();
  await expect(page).toHaveURL(/\/library/);
  await expect(page.getByText(`${n} kelime eklendi`, { exact: true })).toBeVisible();
  const list = page.getByRole('list', { name: 'Notlar' });
  await expect(list.getByRole('listitem')).toHaveCount(n);
  await expect(list.getByText('gönülsüz')).toBeVisible();
  await expect(list.getByText('cope', { exact: true })).toHaveCount(0);

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
  await page.getByRole('button', { name: 'Kelimeleri çıkar' }).click();
  await expect(page.getByText('1 parça önbellekten geldi, AI çağrılmadı.')).toBeVisible();
  expect(backend.count('ai-extract')).toBe(1);
  expect(backend.model.calls).toBe(1);
  await page.getByRole('link', { name: 'Önizlemeyi aç' }).first().click();
  // Everything already added is marked "Zaten var" and unselected; only "cope" is new.
  await expect(page.getByText(`1/${SPECS.length} seçili`).first()).toBeVisible();
});

test('another device (fresh browser): the same text is answered by the server cache and lexicon, no model call', async ({
  browser,
  page,
  backend,
}) => {
  await page.goto('/add?tab=paste');
  await page.getByLabel('İngilizce metin').fill(TEXT);
  await page.getByRole('button', { name: 'Kelimeleri çıkar' }).click();
  await expect(page.getByText('Adaylar hazır')).toBeVisible();
  expect(backend.model.calls).toBe(1);

  // Second device of the same user: empty IndexedDB, same backend.
  const ctx2 = await browser.newContext({ serviceWorkers: 'block', locale: 'tr-TR' });
  await backend.install(ctx2);
  await FakeBackend.signIn(ctx2);
  const page2 = await ctx2.newPage();
  await page2.goto('/add?tab=paste');
  await page2.getByLabel('İngilizce metin').fill(TEXT);
  await page2.getByRole('button', { name: 'Kelimeleri çıkar' }).click();
  await expect(page2.getByText('Adaylar hazır')).toBeVisible();
  expect(backend.count('ai-extract')).toBe(2); // the request is made ...
  expect(backend.model.calls).toBe(1); // ... but the model is not called again
  expect(backend.store.senses.size).toBe(SPECS.length); // one lexicon row per sense, no duplicates
  await ctx2.close();
});
