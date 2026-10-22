// "Paylaş → Engapp" (v0.4 İP6, decision 0034): the /share route in the web build, at phone
// width. The Android app opens the same route from its share intent (src/native/share.ts); the
// installed PWA reaches it through the manifest's share_target (GET).
import type { Page } from '@playwright/test';
import { FAKE_SPECS } from '../../src/features/import/testing/fakeSpecs.ts';
import { FakeBackend } from './support/backend.ts';
import { expect, test } from './support/app.ts';

test.use({ viewport: { width: 360, height: 740 } });

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test('a shared word opens the card preview for that term', async ({ page }) => {
  await page.goto('/share?text=%E2%80%9CSerendipity.%E2%80%9D');
  await expect(page).toHaveURL(/\/add\?term=Serendipity$/);
  await expect(page.getByLabel('İngilizce kelime ya da kalıp')).toHaveValue('Serendipity');
  await noSideScroll(page);
});

test('a shared link shows only its title and says full articles come later', async ({ page }) => {
  await page.goto(
    '/share?title=Why%20we%20all%20procrastinate%20so%20much&url=https%3A%2F%2Fexample.com%2Fstory%3Fid%3D1',
  );
  await expect(page.getByRole('heading', { name: 'Paylaşılan bağlantı' })).toBeVisible();
  await expect(page.getByTestId('shared-title')).toHaveText('Why we all procrastinate so much');
  await expect(page.getByTestId('shared-url')).toHaveText('https://example.com/story?id=1');
  await expect(page.getByText(/Makalenin tamamını içe aktarma sonraki sürümde/)).toBeVisible();
  await noSideScroll(page);

  // The title can still be mined for words (it becomes a shared text).
  await page.getByRole('link', { name: 'Başlıktaki kelimeleri bul' }).click();
  await expect(page.getByTestId('shared-text')).toHaveText('Why we all procrastinate so much');
});

test('a link without a title shows the address', async ({ page }) => {
  await page.goto('/share?text=https%3A%2F%2Fexample.com%2Fx');
  await expect(page.getByTestId('shared-url')).toHaveText('https://example.com/x');
  await expect(page.getByText(/başlığı gelmedi/)).toBeVisible();
  await expect(page.getByTestId('shared-title')).toHaveCount(0);
});

test('nothing usable: a calm empty state', async ({ page }) => {
  await page.goto('/share');
  await expect(page.getByRole('heading', { name: 'Paylaşılan bir metin yok' })).toBeVisible();
});

test('a guest sharing a sentence keeps the text and is invited to sign in', async ({ page }) => {
  const text = FAKE_SPECS[0]!.sentence;
  await page.goto(`/share?text=${encodeURIComponent(text)}`);
  await expect(page.getByRole('heading', { name: 'Metinden kelime çıkar' })).toBeVisible();
  await expect(page.getByTestId('shared-text')).toHaveText(text);
  await expect(page.getByText('AI ile kart çıkarmak için giriş yap')).toBeVisible();
  await noSideScroll(page);
});

test('signed in: a shared sentence lands in the extraction preview within 10 s', async ({
  context,
  page,
  backend,
}) => {
  await FakeBackend.signIn(context);
  const specs = FAKE_SPECS.slice(0, 3);
  const text = specs.map((s) => s.sentence).join(' ');
  const started = Date.now();
  await page.goto(`/share?text=${encodeURIComponent(text)}`);
  await expect(page).toHaveURL(/\/import\/[0-9a-f-]+$/, { timeout: 10_000 });
  // The candidates come with the sentence they were found in (the shared text).
  await expect(page.getByTestId('smart-summary')).toBeVisible({ timeout: 10_000 });
  expect(Date.now() - started).toBeLessThan(10_000);
  expect(backend.count('ai-extract')).toBe(1);
  await expect(
    page.getByText(specs[0]!.sentence.slice(0, 30), { exact: false }).first(),
  ).toBeVisible();
  await noSideScroll(page);
});
