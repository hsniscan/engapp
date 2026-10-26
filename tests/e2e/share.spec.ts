// "Paylaş → Engapp" (v0.4 İP6, decision 0034): the /share route in the web build, at phone
// width. The Android app opens the same route from its share intent (src/native/share.ts); the
// installed PWA reaches it through the manifest's share_target (GET).
import type { Page } from '@playwright/test';
import { FAKE_SPECS } from '../../src/features/import/testing/fakeSpecs.ts';
import { FakeBackend, SUPABASE_URL } from './support/backend.ts';
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

test('a guest sharing a link: sign-in message, copy-paste hint and the title-only way', async ({
  page,
}) => {
  await page.goto(
    '/share?title=Why%20we%20all%20procrastinate%20so%20much&url=https%3A%2F%2Fexample.com%2Fstory%3Fid%3D1',
  );
  await expect(page.getByRole('heading', { name: 'Paylaşılan bağlantı' })).toBeVisible();
  await expect(page.getByTestId('shared-title')).toHaveText('Why we all procrastinate so much');
  await expect(page.getByTestId('shared-url')).toHaveText('https://example.com/story?id=1');
  await expect(page.getByTestId('signin-needed-title')).toHaveText(
    'Makale getirmek için giriş yap',
  );
  await expect(page.getByTestId('article-signin')).toContainText('kopyalayıp yapıştırırsan');
  await noSideScroll(page);

  // The title can still be mined for words (it becomes a shared text).
  await page.getByRole('link', { name: 'Başlıktaki kelimeleri bul' }).click();
  await expect(page.getByTestId('shared-text')).toHaveText('Why we all procrastinate so much');
});

test('a link without a title shows the address', async ({ page }) => {
  await page.goto('/share?text=https%3A%2F%2Fexample.com%2Fx');
  await expect(page.getByTestId('shared-url')).toHaveText('https://example.com/x');
  await expect(page.getByTestId('shared-title')).toHaveCount(0);
});

/** Mocks POST /functions/v1/fetch-article (registered after the fake backend, so it wins). */
async function mockFetchArticle(page: Page, reply: { status: number; body: unknown }) {
  const calls: unknown[] = [];
  await page.context().route(`${SUPABASE_URL}/functions/v1/fetch-article`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204 });
    calls.push(req.postDataJSON());
    return route.fulfill({
      status: reply.status,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(reply.body),
    });
  });
  return calls;
}

const ARTICLE = {
  url: 'https://example.com/story?id=1',
  title: 'Why we all procrastinate so much',
  byline: 'Ana Lima',
  site: 'Mind Matters',
  lang: 'en',
  paragraphs: [
    'Most of us put off at least one task every day, even when we know it will cost us later.',
    'Researchers say the habit is less about laziness and more about avoiding a bad feeling.',
  ],
  truncated: false,
  usage: { used: 1, limit: 30 },
};

test('signed in: a shared link brings the whole article and opens it in the reader', async ({
  context,
  page,
  backend,
}) => {
  void backend; // the fake Supabase (auth, sync) behind the signed-in session
  await FakeBackend.signIn(context);
  const calls = await mockFetchArticle(page, { status: 200, body: ARTICLE });
  await page.goto(
    '/share?title=Why%20we%20all%20procrastinate%20so%20much&url=https%3A%2F%2Fexample.com%2Fstory%3Fid%3D1',
  );
  await expect(page.getByTestId('text-result-title')).toHaveText(ARTICLE.title);
  await expect(page.getByTestId('text-result-body')).toContainText('put off at least one task');
  await expect(page.getByTestId('text-extract')).toBeVisible();
  expect(calls).toEqual([{ url: 'https://example.com/story?id=1' }]);
  await noSideScroll(page);
  await page.getByTestId('text-open-reader').click();
  await expect(page).toHaveURL(/\/oku\/[0-9a-f-]+$/);
});

test('signed in: a paywalled link says so and keeps the copy-paste and title ways', async ({
  context,
  page,
  backend,
}) => {
  void backend; // the fake Supabase (auth, sync) behind the signed-in session
  await FakeBackend.signIn(context);
  await mockFetchArticle(page, {
    status: 422,
    body: { error: { code: 'paywalled', message: 'The page is for subscribers only.' } },
  });
  await page.goto(
    '/share?title=Why%20we%20all%20procrastinate%20so%20much&url=https%3A%2F%2Fexample.com%2Fstory%3Fid%3D1',
  );
  await expect(page.getByText('Bu sayfa alınamadı')).toBeVisible();
  await expect(page.getByTestId('article-error-message')).toContainText('yalnızca abonelere açık');
  await expect(page.getByTestId('article-paste')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Başlıktaki kelimeleri bul' })).toBeVisible();
  await noSideScroll(page);
});

test('nothing usable: a calm empty state', async ({ page }) => {
  await page.goto('/share');
  await expect(page.getByRole('heading', { name: 'Paylaşılan bir metin yok' })).toBeVisible();
});

test('a guest sharing a sentence reads it in the reader; only extraction asks for sign-in', async ({
  page,
}) => {
  const text = FAKE_SPECS[0]!.sentence;
  await page.goto(`/share?text=${encodeURIComponent(text)}`);
  await expect(page.getByRole('heading', { name: 'Paylaşılan metin' })).toBeVisible();
  await expect(page.getByTestId('shared-text')).toHaveText(text);
  await expect(page.getByText(/Kelimeleri çıkarmayı yapay zekâ yapar; bunun için giriş yap/)).toBeVisible();
  await noSideScroll(page);
  await page.getByTestId('open-in-reader').click();
  await expect(page).toHaveURL(/\/oku\/[0-9a-f-]+$/);
  await expect(page.getByTestId('reader-text')).toContainText(text.split(' ').slice(0, 4).join(' '));
});

test('signed in: a shared text waits for a choice, then lands in the extraction preview', async ({
  context,
  page,
  backend,
}) => {
  await FakeBackend.signIn(context);
  const specs = FAKE_SPECS.slice(0, 3);
  const text = specs.map((s) => s.sentence).join(' ');
  await page.goto(`/share?text=${encodeURIComponent(text)}`);
  // v0.5.1: nothing starts by itself; the two choices are shown, reading first.
  await expect(page.getByTestId('shared-text')).toBeVisible();
  const choices = page.getByTestId('capture-actions').getByRole('button');
  await expect(choices).toHaveCount(2);
  await expect(choices.first()).toContainText('Okuyucuda aç');
  await expect(choices.nth(1)).toContainText('Bu metindeki kelimeleri çıkar');
  expect(backend.count('ai-extract')).toBe(0);
  const started = Date.now();
  await choices.nth(1).click();
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
