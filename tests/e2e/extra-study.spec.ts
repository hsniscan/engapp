import { addWord, dumpTables, expect, reviewAll, test, WORDS, type Word } from './support/app.ts';
import { FakeBackend } from './support/backend.ts';

const MORE: Word[] = [
  ...WORDS,
  { term: 'scarce', meaning: 'kıt' },
  { term: 'curb', meaning: 'dizginlemek' },
  { term: 'feasible', meaning: 'uygulanabilir' },
  { term: 'hinder', meaning: 'engellemek' },
  { term: 'tackle', meaning: 'ele almak' },
];

// İP1 "Ekstra çalışma": finish today, then "Biraz daha çalış" → +5 new cards → a practice
// round that leaves every schedule exactly as it was.
test('done for today → "Biraz daha çalış": +5 new cards, then a practice round that changes no schedule', async ({
  page,
}) => {
  test.setTimeout(120_000);
  for (const w of MORE) await addWord(page, w); // 8 notes → 8 new recognition cards

  // Daily new-card limit 2.
  await page.goto('/settings/calisma');
  const slider = page.getByRole('slider', { name: 'Günlük yeni kart' });
  await slider.focus();
  await page.keyboard.press('Home');
  await slider.press('ArrowRight');
  await slider.press('ArrowRight');
  await expect(slider).toHaveAttribute('aria-valuenow', '2');
  await page.waitForTimeout(600); // the slider saves 400 ms after the last change

  // Today's session: exactly the 2 new cards (Easy graduates them).
  await page.goto('/');
  await page.getByTestId('start-study').click();
  expect(await reviewAll(page, '4')).toBe(2);
  await page.getByRole('link', { name: 'Biraz daha çalış' }).click();
  await expect(page).toHaveURL(/\/study\/more$/);
  await expect(page.getByRole('heading', { name: 'Biraz daha çalış', level: 1 })).toBeVisible();
  const newCards = page.getByRole('region', { name: 'Yeni kartlar' });
  await expect(newCards.getByText('Bekleyen yeni kart: 6')).toBeVisible();

  // +5: exactly five more cards today, then done again.
  await newCards.getByRole('button', { name: '+5 yeni kart' }).click();
  await expect(page).toHaveURL(/\/study\?mode=word$/);
  expect(await reviewAll(page, '4')).toBe(5);

  await page.goto('/');
  await expect(page.getByTestId('today-hero-done')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Biraz daha çalış' })).toBeVisible();
  await page.goto('/more'); // the old address still leads to the extra-study page
  await expect(newCards.getByText('Bekleyen yeni kart: 1')).toBeVisible();
  await expect(newCards.getByText('Bugün 5 ek kart açtın.')).toBeVisible();

  // Practice: the 7 cards first studied this week. Nothing was hard, so that source is off.
  const practice = page.getByRole('region', { name: 'Pratik turu' });
  await expect(practice.getByRole('radio', { name: /Zorlandıklarım/ })).toBeDisabled();
  await expect(practice.getByRole('radio', { name: /Son 7 günde/ })).toBeChecked();
  await expect(practice.getByText('7 kelime')).toBeVisible();

  const before = await dumpTables(page, ['cards', 'review_logs', 'daily_activity']);
  expect(before.review_logs).toHaveLength(7);

  await practice.getByRole('button', { name: 'Pratiğe başla' }).click();
  await expect(page).toHaveURL(/\/practice\?source=recent&size=10$/);
  await expect(page.getByText('Pratik · takvim ve seri değişmez')).toBeVisible();

  // Keyboard only: Space flips, 1 = Bilemedim (asked again at the end), 2 = Bildim.
  const done = page.getByRole('heading', { name: 'Pratik bitti' });
  let answers = 0;
  for (; answers < 40; answers++) {
    const show = page.getByRole('button', { name: 'Cevabı göster', disabled: false });
    await expect(show.or(done)).toBeVisible();
    if (await done.isVisible()) break;
    await page.locator('body').press('Space');
    await expect(page.getByRole('group', { name: 'Bildin mi?' })).toBeVisible();
    await page.locator('body').press(answers === 0 ? '1' : '2');
  }
  expect(answers).toBe(8); // 7 cards + the missed one once more
  await expect(page.getByText('Kartlarının takvimi değişmedi; pratik seriye sayılmaz.')).toBeVisible();
  await expect(page.getByText('6/7')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'En çok zorlandıkların' })).toBeVisible();

  // Schedules, review logs and today's activity are untouched; the round is in practice_logs.
  await expect
    .poll(async () => (await dumpTables(page, ['practice_logs'])).practice_logs?.length)
    .toBe(8);
  const after = await dumpTables(page, ['cards', 'review_logs', 'daily_activity']);
  expect(after).toEqual(before);

  // "Bir tur daha" starts a new round right away.
  await page.getByRole('button', { name: 'Bir tur daha' }).click();
  await expect(page.getByRole('button', { name: 'Cevabı göster', disabled: false })).toBeVisible();
});

test('signed in: practice logs reach the server as insert-only rows', async ({
  page,
  context,
  backend,
}) => {
  await FakeBackend.signIn(context);
  await page.goto('/');
  for (const w of WORDS) await addWord(page, w);
  await page.goto('/review');
  await reviewAll(page, '4');
  await page.goto('/practice?source=recent&size=10');
  const done = page.getByRole('heading', { name: 'Pratik bitti' });
  for (let i = 0; i < 20; i++) {
    const show = page.getByRole('button', { name: 'Cevabı göster', disabled: false });
    await expect(show.or(done)).toBeVisible();
    if (await done.isVisible()) break;
    await page.locator('body').press('Space');
    await page.locator('body').press('2');
  }
  await expect(done).toBeVisible();
  await expect.poll(() => backend.pushedIds('practice_logs').length, { timeout: 15_000 }).toBe(3);
  expect(backend.count('sync_pull_v3')).toBeGreaterThan(0);
});
