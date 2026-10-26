import { addWord, expect, test, WORDS, type Word } from './support/app.ts';

const MORE: Word[] = [
  ...WORDS,
  { term: 'scarce', meaning: 'kıt' },
  { term: 'curb', meaning: 'dizginlemek' },
];

test('daily new-card limit in Ayarlar changes the "Yeni" count on the home screen', async ({
  page,
}) => {
  for (const w of MORE) await addWord(page, w);
  await page.goto('/');
  // "N tekrar · M yeni · yaklaşık K dk" in the hero.
  const newCount = page.getByTestId('today-hero').getByText(/ tekrar · \d+ yeni/);
  const newOf = async () => Number(/· (\d+) yeni/.exec((await newCount.textContent()) ?? '')![1]);
  await expect(newCount).toBeVisible();
  const initial = await newOf();
  expect(initial).toBeGreaterThan(2);

  await page.goto('/settings#calisma');
  const slider = page.getByRole('slider', { name: 'Günlük yeni kart' });
  await expect(slider).toHaveAttribute('aria-valuenow', '10');
  await slider.focus();
  for (let i = 0; i < 8; i++) await slider.press('ArrowLeft');
  await expect(slider).toHaveAttribute('aria-valuenow', '2');
  await expect(page.getByText('2 kart', { exact: true })).toBeVisible();
  await page.waitForTimeout(600); // the slider saves 400 ms after the last change

  await page.getByRole('link', { name: 'Bugün', exact: true }).first().click();
  await expect(newCount).toContainText('· 2 yeni');

  // 0 = no new cards today.
  await page.goto('/settings#calisma');
  await page.getByRole('slider', { name: 'Günlük yeni kart' }).focus();
  await page.keyboard.press('Home');
  await expect(page.getByText('Yeni kart yok', { exact: true })).toBeVisible();
  await page.waitForTimeout(600);
  await page.goto('/');
  await expect(page.getByTestId('today-hero-done')).toContainText('Bugün tekrar yok');
});

test('theme switch persists across a reload (stored before first paint, no flash)', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/settings#gorunum');
  await page.locator('label', { hasText: 'Koyu' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.reload();
  // The inline script in index.html applies it before React loads.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(bg);
  await expect(page.getByRole('radio', { name: 'Koyu' })).toBeChecked();

  await page.locator('label', { hasText: 'Sistem' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'system');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'system');
});
