import { addWord, expect, reviewAll, test, WORDS } from './support/app.ts';

// Plan, "Uçtan uca": first open → add words by hand → full review with the keyboard → streak 1.
test('first open: add 3 words, review with the keyboard (Space, 1–4, Z), streak becomes 1', async ({
  page,
  backend,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Hoş geldin' })).toBeVisible();
  await page.getByRole('link', { name: 'İlk kelimeni ekle' }).click();
  await expect(page).toHaveURL(/\/add$/);

  for (const w of WORDS) await addWord(page, w);

  await page.getByRole('link', { name: 'Ana', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Bugün', level: 1 })).toBeVisible();
  await page.getByRole('link', { name: 'Tekrara başla' }).click();
  await expect(page).toHaveURL(/\/review$/);

  // First card: answer, then undo with Z and answer again.
  await expect(page.getByRole('button', { name: 'Cevabı göster' })).toBeEnabled();
  const card = page.locator('[data-card-type]');
  const firstCard = await card.textContent();
  await page.locator('body').press('Space');
  await page.locator('body').press('1');
  await expect(page.getByRole('button', { name: 'Son cevabı geri al (Z)' })).toBeVisible();
  await page.locator('body').press('z');
  await expect(page.getByText('Son cevap geri alındı', { exact: true })).toBeVisible();
  await expect.poll(() => card.textContent()).toBe(firstCard);

  const answered = await reviewAll(page, '3');
  expect(answered).toBeGreaterThanOrEqual(WORDS.length);
  await expect(page.getByRole('heading', { name: 'Oturum tamamlandı' })).toBeVisible();
  await expect(page.getByText('Bugün serine eklendi.')).toBeVisible();

  await page.goto('/');
  const streak = page.getByRole('region', { name: 'Günlük seri' });
  await expect(streak.getByText('1', { exact: true }).first()).toBeVisible();
  await expect(streak.getByText('bugünkü tekrar tamam')).toBeVisible();

  // A guest never talks to the backend.
  expect(backend.calls).toEqual([]);
});
