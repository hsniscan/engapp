// Article and subtitle import (v0.5 İP2, decision 0044) at phone width. fetch-article is
// mocked; subtitle files are parsed in the page itself.
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expect, test } from './support/app.ts';
import { FakeBackend, SUPABASE_URL } from './support/backend.ts';

test.use({ viewport: { width: 360, height: 740 } });

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

const ARTICLE = {
  url: 'https://news.example/city/bikes',
  title: 'City council approves new bike lanes',
  byline: 'Lena Ortiz',
  site: 'The Riverside Gazette',
  lang: 'en',
  paragraphs: [
    'After more than four hours of discussion, the council voted seven to two in favour of the plan.',
    'The first section, along the river, is expected to open next spring.',
  ],
  truncated: false,
  usage: { used: 1, limit: 30 },
};

test('Add sheet → "Bağlantıdan makale": paste an address, read the article', async ({
  context,
  page,
  backend,
}) => {
  void backend; // the fake Supabase (auth, sync) behind the signed-in session
  await FakeBackend.signIn(context);
  const calls: unknown[] = [];
  await context.route(`${SUPABASE_URL}/functions/v1/fetch-article`, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204 });
    calls.push(route.request().postDataJSON());
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(ARTICLE),
    });
  });
  await page.goto('/');
  await page.getByTestId('nav-add').click();
  await page.getByTestId('add-way-article').click();
  await expect(page).toHaveURL(/\/makale$/);
  await page.getByTestId('article-url').fill('news.example/city/bikes');
  await page.getByTestId('article-submit').click();
  await expect(page.getByTestId('text-result-title')).toHaveText(ARTICLE.title);
  expect(calls).toEqual([{ url: 'https://news.example/city/bikes' }]);
  await noSideScroll(page);
  await page.getByTestId('text-open-reader').click();
  await expect(page).toHaveURL(/\/oku\/[0-9a-f-]+$/);
});

test('a guest on /makale is invited to sign in, nothing is fetched', async ({ page }) => {
  let called = false;
  await page.context().route(`${SUPABASE_URL}/functions/v1/fetch-article`, (route) => {
    called = true;
    return route.abort();
  });
  await page.goto('/makale?url=https%3A%2F%2Fnews.example%2Fa');
  await expect(page.getByText('AI ile kart çıkarmak için giriş yap')).toBeVisible();
  expect(called).toBe(false);
});

test('Add sheet → "Altyazı dosyası": an .srt file becomes a reader text on the device', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByTestId('nav-add').click();
  await page.getByTestId('add-way-subtitle').click();
  await expect(page).toHaveURL(/\/altyazi$/);
  await page
    .getByTestId('subtitle-file')
    .setInputFiles(fileURLToPath(new URL('../fixtures/subtitles/basic.srt', import.meta.url)));
  await expect(page.getByTestId('text-result-body')).toContainText(
    'Have you ever wondered why the sky is blue? Most people never ask.',
  );
  await expect(page.getByTestId('text-result-body')).not.toContainText('-->');
  await noSideScroll(page);
  await page.getByTestId('text-open-reader').click();
  await expect(page).toHaveURL(/\/oku\/[0-9a-f-]+$/);
});
