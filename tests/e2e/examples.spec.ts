// v0.2 İP5: example sentences on the back of a card, with like / reject and sync. Since v0.5.2
// (ADR 0061) the sentences are shipped content (written once in bulk): the app pulls and
// shows them and never asks a model for more.
import { FAKE_SPECS } from '../../src/features/import/testing/fakeSpecs.ts';
import { FakeBackend } from './support/backend.ts';
import { dumpTables, expect, test } from './support/app.ts';

const SPEC = FAKE_SPECS.find((s) => s.term === 'reluctant')!;
const SHOTS = process.env.E2E_SHOTS_DIR;

test.beforeEach(async ({ context }) => {
  await FakeBackend.signIn(context);
});

test('signed in: shipped sentences arrive with a new card and are controlled on its back', async ({ page, backend }) => {
  // The bulk job already wrote sentences for every word: two per context here.
  backend.autoShipExamples = 2;
  // One imported word with a lexicon sense.
  await page.goto('/add?tab=paste');
  await expect(page.getByText('Hesabına bağlandın', { exact: true })).toBeVisible();
  await page.getByLabel('İngilizce metin').fill(SPEC.sentence);
  await page.getByRole('button', { name: 'Kelimeleri çıkar' }).click();
  // v0.5.1: the extraction opens its preview by itself.
  await expect(page.getByTestId('smart-summary')).toBeVisible();
  // Smart extraction (İP4) does not pre-select a lone B2 word for a B1 learner: pick it.
  await page.getByRole('checkbox', { name: 'reluctant seç' }).check();
  await page.getByRole('button', { name: '1 kelimeyi ekle' }).click();
  await expect(page.getByText('1 kelime eklendi', { exact: true })).toBeVisible();

  // The sync pull brings the shipped sentences of the new sense (daily 2, conversation,
  // work, formal, travel 1 each); nothing asks for sentences.
  await expect
    .poll(async () => (await dumpTables(page, ['lexicon_examples'])).lexicon_examples!.length, { timeout: 20_000 })
    .toBe(6);
  expect(backend.count('ai-examples')).toBe(0);

  // Back of the card: the section opens on demand.
  await page.goto('/review');
  await page.getByRole('button', { name: 'Cevabı göster' }).click();
  const back = page.getByRole('region', { name: 'Arka yüz' });
  await back.getByRole('button', { name: 'Örnek cümleler' }).click();
  const tabs = back.getByRole('tablist', { name: 'Bağlamlar' });
  // Only contexts with sentences get a tab (the four selected ones and "Seyahat").
  await expect(tabs.getByRole('tab')).toHaveCount(5);
  await expect(back.getByText(/My brother was/)).toBeVisible();
  await expect(back.getByText('Kardeşim akşam yemeğinden sonra bulaşıkları yıkamaya isteksizdi.')).toHaveCount(0);
  await back.getByRole('button', { name: 'Türkçesini göster' }).last().click();
  await expect(back.getByText('Kardeşim akşam yemeğinden sonra bulaşıkları yıkamaya isteksizdi.')).toBeVisible();

  if (SHOTS) {
    await page.screenshot({ path: `${SHOTS}/examples-light.png`, fullPage: true });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({ path: `${SHOTS}/examples-dark.png`, fullPage: true });
    await page.emulateMedia({ colorScheme: 'light' });
  }

  // Like: a toggle with a text label, synced to the account.
  await back.getByRole('button', { name: 'Beğen' }).click();
  await expect(back.getByRole('button', { name: 'Beğendin' })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => backend.pushedIds('content_feedback').length, { timeout: 20_000 }).toBe(1);

  // No generation controls: the second daily sentence is already there.
  await expect(back.getByRole('button', { name: 'Yenisini üret' })).toHaveCount(0);
  await expect(back.getByRole('button', { name: 'Bağlam ekle' })).toHaveCount(0);
  await expect(back.getByText('1 / 2')).toBeVisible();
  await back.getByRole('button', { name: 'Sonraki cümle' }).click();
  await expect(back.getByText(/The children were reluctant/)).toBeVisible();

  // Reject: gone for good (undo is offered).
  await back.getByRole('button', { name: 'Cümle için diğer işlemler' }).click();
  await page.getByRole('menuitem', { name: 'Reddet' }).click();
  await expect(page.getByText('Cümle reddedildi; bir daha gösterilmeyecek.').first()).toBeVisible();
  await expect(back.getByText(/The children were reluctant/)).toHaveCount(0);
  await expect(back.getByText(/My brother was/)).toBeVisible();

  expect(backend.count('ai-examples')).toBe(0);

  // Another context tab.
  await tabs.getByRole('tab', { name: /İş/ }).click();
  await expect(back.getByText(/Our manager was reluctant/)).toBeVisible();

  if (SHOTS) {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ path: `${SHOTS}/examples-phone-light.png`, fullPage: true });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({ path: `${SHOTS}/examples-phone-dark.png`, fullPage: true });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.setViewportSize({ width: 1280, height: 900 });
  }

  // Answering still works with the section open.
  await page.getByRole('group', { name: 'Ne kadar iyi hatırladın?' }).getByRole('button').nth(2).click();
  await expect.poll(() => backend.pushedIds('content_feedback').length, { timeout: 20_000 }).toBe(2);

  if (SHOTS) {
    await page.goto('/settings/kartlar#ornekler');
    const section = page.locator('#ornekler');
    await expect(section.getByRole('group', { name: 'Kartta dönen bağlamlar' })).toBeVisible();
    await section.screenshot({ path: `${SHOTS}/settings-light.png` });
    await page.emulateMedia({ colorScheme: 'dark' });
    await section.screenshot({ path: `${SHOTS}/settings-dark.png` });
    await page.emulateMedia({ colorScheme: 'light' });
    await section.screenshot({ path: `${SHOTS}/settings-light.png` });

    // Word detail: the same section, always open.
    await page.goto('/library');
    await page.getByRole('list', { name: 'Kelimeler' }).getByText('reluctant', { exact: true }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('heading', { name: 'Örnek cümleler' })).toBeVisible();
    await expect(sheet.getByText(/Our manager was|My brother was/).first()).toBeVisible();
    await sheet.getByRole('heading', { name: 'Örnek cümleler' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/detail-light.png` });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({ path: `${SHOTS}/detail-dark.png` });
  }
});
