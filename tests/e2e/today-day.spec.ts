// v0.5.1 Bugün shows the whole day (docs/decisions/0055-today-whole-day.md): the hero counts
// every mode and leads to the next one, a wrong typed answer needs a confirm before Zor / İyi /
// Kolay, the session counts cards (+n tekrar) and the summary names words, and a new user's
// Çalış page offers first steps.
import type { Page } from '@playwright/test';
import { addWord, dumpTables, expect, test, WORDS } from './support/app.ts';
import { restoreSeed } from './support/restore.ts';

const SHOTS = process.env.E2E_SHOTS_DIR;

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

/**
 * Kelime çalışma is done for today (its reviews moved a month ahead, its new cards suspended),
 * and one Üretim and one Boşluk card are due now. Raw IndexedDB, before the app reads it.
 */
async function wordDoneOthersWaiting(page: Page) {
  await page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open('engapp');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const tx = db.transaction('cards', 'readwrite');
    const store = tx.objectStore('cards');
    const all: Record<string, unknown>[] = await new Promise(
      (res) => (store.getAll().onsuccess = (e) => res((e.target as IDBRequest).result)),
    );
    const later = Date.now() + 30 * 86_400_000;
    for (const card of all) {
      if (card.card_type !== 'recognition') continue;
      if (card.state === 0) store.put({ ...card, suspended: true });
      else store.put({ ...card, due: later });
    }
    for (const type of ['production', 'cloze']) {
      const card = all.find((c) => c.card_type === type && c.deleted_at === null && c.state === 2);
      if (card) store.put({ ...card, due: Date.now() - 60_000, unlocked: true, suspended: false });
    }
    await new Promise((res) => (tx.oncomplete = res));
    db.close();
  });
}

test('Bugün: Kelime done → the hero leads to Üretim; a wrong typed answer needs a confirm', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await restoreSeed(page, 150);
  await wordDoneOthersWaiting(page);

  await page.goto('/');
  const hero = page.getByTestId('today-hero');
  await expect(hero).toBeVisible();
  // Not "Bugünlük tamam": the hero still counts Üretim and Boşluk.
  await expect(page.getByTestId('today-hero-done')).toHaveCount(0);
  await expect(page.getByTestId('study-type-word')).toHaveAttribute('data-done', 'true');
  await expect(page.getByTestId('study-type-production')).toHaveAccessibleName(/Üretim\s+\d+ kart/);
  await expect(page.getByTestId('study-type-cloze')).toHaveAccessibleName(
    /Boşluk doldurma\s+\d+ kart/,
  );
  const cta = page.getByTestId('start-study');
  await expect(cta).toHaveText(/Üretime geç \(\d+\)/);
  await expect(cta).toHaveAttribute('href', '/study?mode=production');
  // "Biraz daha çalış" waits until every mode is done.
  await expect(page.getByRole('region', { name: 'Biraz daha çalış' })).toHaveCount(0);
  await shot(page, 'bugun-hero');
  if (SHOTS) {
    await page.emulateMedia({ colorScheme: 'dark' });
    await shot(page, 'bugun-hero-dark');
    await page.emulateMedia({ colorScheme: 'light' });
  }

  // Üretim: a wrong typed answer. Tekrar is suggested; İyi needs a second tap.
  const t0 = await page.evaluate(() => Date.now());
  await cta.click();
  await expect(page).toHaveURL(/\/study\?mode=production$/);
  const progress = page.getByTestId('study-progress');
  await expect(progress).toHaveText(/^0 \/ \d+/);
  const total = Number(/\/ (\d+)/.exec((await progress.textContent()) ?? '')?.[1]);
  const input = page.getByTestId('answer-input');
  await input.fill('zzzz');
  await input.press('Enter');
  const confirm = page.getByTestId('rating-confirm');
  await expect(confirm).toHaveText(/Tekrar öneriyoruz/);
  const bar = page.getByRole('group', { name: /Ne kadar iyi hatırladın\?/ });
  await bar.getByRole('button', { name: /İyi/ }).click();
  await expect(confirm).toHaveText(/Yine de “İyi” mi\?/);
  await expect(page.getByText('Bu sefer olmadı')).toBeVisible(); // still on this card
  await expect(progress).toHaveText(/^0 \//);
  await shot(page, 'rating-confirm');
  await bar.getByRole('button', { name: /İyi/ }).click();
  // One card answered. The count of cards grows only when a card falls due meanwhile (the
  // seed's cards come due through the day; on a slow machine more of them), never with
  // learning steps: at most one more than the production cards that fell due during the test.
  await expect(progress).toHaveText(/^1 \/ \d+/);
  const after = Number(/\/ (\d+)/.exec((await progress.textContent()) ?? '')?.[1]);
  const t1 = await page.evaluate(() => Date.now());
  const { cards } = await dumpTables(page, ['cards']);
  const fellDue = (cards as { card_type: string; due: number }[]).filter(
    (c) => c.card_type === 'production' && c.due > t0 && c.due <= t1,
  ).length;
  expect(after - total).toBeLessThanOrEqual(fellDue + 1);
});

test('a new user’s Çalış page shows first steps; a session counts cards and the summary words', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/study');
  const welcome = page.getByTestId('study-welcome');
  await expect(welcome).toContainText('Çalışacak kelimen yok');
  await expect(welcome.getByRole('link', { name: 'Hazır desteye göz at' })).toHaveAttribute(
    'href',
    '/kesfet?f=desteler',
  );
  await welcome.getByRole('button', { name: 'İlk kelimeni ekle' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');

  for (const w of WORDS) await addWord(page, w);
  await page.goto('/study?mode=word');
  const progress = page.getByTestId('study-progress');
  await expect(progress).toHaveText(/^0 \/ 3/);
  // Tekrar on the first card: one card done, its step comes back as "+1 tekrar".
  await page.getByRole('button', { name: 'Cevabı göster', disabled: false }).click();
  await page.locator('body').press('1');
  await expect(progress).toHaveText(/^1 \/ 3\s*\+1 tekrar/);

  const summary = page.getByRole('heading', { name: 'Oturum tamamlandı' });
  for (let n = 0; n < 20; n++) {
    const show = page.getByRole('button', { name: 'Cevabı göster', disabled: false });
    await expect(show.or(summary)).toBeVisible();
    if (await summary.isVisible()) break;
    await show.click();
    await page.locator('body').press('4');
  }
  await expect(page.getByTestId('summary-words')).toContainText('3 kelime çalıştın');
  // Every mode is done: home first, then "Biraz daha çalış"; no next-mode button.
  await expect(page.getByRole('link', { name: 'Biraz daha çalış' })).toBeVisible();
  await expect(page.getByTestId('summary-next')).toHaveCount(0);
  if (SHOTS) {
    await page.waitForTimeout(1500); // the summary fades in
    await shot(page, 'oturum-ozeti');
  }
});
