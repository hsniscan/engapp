// v0.2 İP5: example sentences on the back of a card, prepared in the background by the real
// ai-examples pipeline (FakeBackend), with like / reject / "Yenisini üret" and sync.
import { FAKE_SPECS } from '../../src/features/import/testing/fakeSpecs.ts';
import { FakeBackend } from './support/backend.ts';
import { dumpTables, expect, test } from './support/app.ts';

const SPEC = FAKE_SPECS.find((s) => s.term === 'reluctant')!;
const SHOTS = process.env.E2E_SHOTS_DIR;

test.beforeEach(async ({ context }) => {
  await FakeBackend.signIn(context);
});

test('signed in: sentences are prepared for a new card and controlled on its back', async ({ page, backend }) => {
  // One imported word with a lexicon sense.
  await page.goto('/add?tab=paste');
  await expect(page.getByText('Hesabına bağlandın', { exact: true })).toBeVisible();
  await page.getByLabel('İngilizce metin').fill(SPEC.sentence);
  await page.getByRole('button', { name: 'Kelimeleri çıkar' }).click();
  await expect(page.getByText('Adaylar hazır')).toBeVisible();
  await page.getByRole('link', { name: 'Önizlemeyi aç' }).click();
  await page.getByRole('button', { name: '1 kelimeyi ekle' }).click();
  await expect(page.getByText('1 kelime eklendi', { exact: true })).toBeVisible();

  // The background queue asks ai-examples once, with dictionary ids only.
  await expect.poll(() => backend.count('ai-examples'), { timeout: 20_000 }).toBeGreaterThan(0);
  const request = backend.calls.find((c) => c.name === 'ai-examples')!.body as Record<string, unknown>;
  expect(Object.keys(request).sort()).toEqual(['contexts', 'level_band', 'sense_ids']);
  expect(request).toMatchObject({ level_band: 'B1', contexts: ['daily', 'conversation', 'work', 'formal'] });
  expect(JSON.stringify(request)).not.toContain('committee');
  await expect
    .poll(async () => (await dumpTables(page, ['lexicon_examples'])).lexicon_examples!.length, { timeout: 10_000 })
    .toBe(4);
  expect(backend.examplesModel.calls).toBe(1);

  // Back of the card: the section opens on demand.
  await page.goto('/review');
  await page.getByRole('button', { name: 'Cevabı göster' }).click();
  const back = page.getByRole('region', { name: 'Arka yüz' });
  await back.getByRole('button', { name: 'Örnek cümleler' }).click();
  const tabs = back.getByRole('tablist', { name: 'Bağlamlar' });
  await expect(tabs.getByRole('tab')).toHaveCount(4);
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

  // "Yenisini üret": one more sentence in this context.
  await back.getByRole('button', { name: 'Yenisini üret' }).click();
  await expect(back.getByText(/The children were reluctant/)).toBeVisible();
  expect(backend.examplesModel.calls).toBe(2);
  const fresh = backend.calls.filter((c) => c.name === 'ai-examples').at(-1)!.body as { fresh?: unknown };
  expect(fresh.fresh).toMatchObject({ context: 'daily' });
  await expect(back.getByText('2 / 2')).toBeVisible();

  // Reject: gone for good (undo is offered).
  await back.getByRole('button', { name: 'Cümle için diğer işlemler' }).click();
  await page.getByRole('menuitem', { name: 'Reddet' }).click();
  await expect(page.getByText('Cümle reddedildi; bir daha gösterilmeyecek.').first()).toBeVisible();
  await expect(back.getByText(/The children were reluctant/)).toHaveCount(0);
  await expect(back.getByText(/My brother was/)).toBeVisible();

  // The shared table never received user text: only the model's sentences are there.
  expect(backend.examples.rows.every((r) => !r.text_en.includes('committee'))).toBe(true);

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
    await page.goto('/settings#ornekler');
    const section = page.locator('#ornekler');
    await expect(section.getByRole('group', { name: 'Hazırlanacak bağlamlar' })).toBeVisible();
    await section.screenshot({ path: `${SHOTS}/settings-light.png` });
    await page.emulateMedia({ colorScheme: 'dark' });
    await section.screenshot({ path: `${SHOTS}/settings-dark.png` });
    await page.emulateMedia({ colorScheme: 'light' });
    await section.screenshot({ path: `${SHOTS}/settings-light.png` });

    // Word detail: the same section, always open.
    await page.goto('/library');
    await page.getByRole('list', { name: 'Notlar' }).getByText('reluctant', { exact: true }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('heading', { name: 'Örnek cümleler' })).toBeVisible();
    await expect(sheet.getByText(/Our manager was|My brother was/).first()).toBeVisible();
    await sheet.getByRole('heading', { name: 'Örnek cümleler' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/detail-light.png` });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({ path: `${SHOTS}/detail-dark.png` });
  }
});
