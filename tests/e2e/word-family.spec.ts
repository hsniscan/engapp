import { addWord, expect, test } from './support/app.ts';

// İP6 as a guest (no backend): the "Aile" row in word detail, a root card from the
// suggestion, a faded family word opening the add form, and the false-friend strip.
test('word family, root card and false-friend warning work offline-first for a guest', async ({ page, backend }) => {
  await page.goto('/add');
  for (const w of [
    { term: 'inspect', meaning: 'denetlemek' },
    { term: 'respect', meaning: 'saygı' },
    { term: 'spectator', meaning: 'seyirci' },
    { term: 'actually', meaning: 'aslında' },
  ])
    await addWord(page, w);

  // Word detail → "Aile".
  await page.goto('/library');
  await page.getByRole('button', { name: /^inspect/ }).click();
  const dialog = page.getByRole('dialog');
  const family = dialog.getByTestId('family-section');
  await expect(family.getByRole('heading', { name: 'Aile' })).toBeVisible();
  await expect(family.getByText('inspect', { exact: true })).toHaveAttribute('aria-current', 'true');
  await expect(family.getByRole('button', { name: 'inspection kelimesini ekle' })).toBeVisible();
  await expect(family.getByText('bakmak', { exact: false }).first()).toBeVisible();

  // Three of the user's words share -spect-: add the root card (recognition only).
  const suggestion = family.getByTestId('morpheme-suggestion');
  await expect(suggestion).toContainText('-spect- kökü 3 kelimende geçiyor: inspect, respect, spectator.');
  await suggestion.getByRole('button', { name: 'Kök kartı ekle' }).click();
  await expect(page.getByText('-spect- kartı eklendi', { exact: true })).toBeVisible();
  await expect(suggestion).toBeHidden();

  // A faded family word: a guest has no dictionary, so the add form opens with it.
  await family.getByRole('button', { name: 'inspection kelimesini ekle' }).click();
  await expect(page).toHaveURL(/\/add\?term=inspection$/);
  await expect(page.getByLabel('İngilizce kelime ya da kalıp')).toHaveValue('inspection');

  // The root card's detail lists the user's words with the root.
  await page.goto('/library');
  await page.getByRole('button', { name: /^-spect-/ }).click();
  await expect(page.getByRole('dialog').getByTestId('family-section')).toContainText('inspect');
  await expect(page.getByRole('dialog').getByRole('group', { name: 'Tür' })).toHaveCount(0);

  // Review until the "actually" card's back: the warning shows with icon and text.
  await page.goto('/review');
  const card = page.locator('[data-card-type]');
  let seen = false;
  for (let i = 0; i < 12 && !seen; i++) {
    await expect(page.getByRole('button', { name: 'Cevabı göster' })).toBeEnabled();
    await page.locator('body').press('Space');
    const strip = page.getByTestId('false-friend');
    if ((await card.getAttribute('data-card-type')) === 'recognition' && (await strip.count()) > 0) {
      await expect(strip).toContainText('Yanıltıcı benzer');
      await expect(strip).toContainText('aktüel = güncel');
      await strip.getByRole('button', { name: 'Gizle' }).click();
      await expect(strip).toBeHidden();
      seen = true;
    }
    await page.locator('body').press('3');
  }
  expect(seen).toBe(true);

  // A guest never talks to the backend.
  expect(backend.calls).toEqual([]);
});
