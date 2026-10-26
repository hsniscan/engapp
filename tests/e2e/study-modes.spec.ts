import type { Page } from '@playwright/test';
import { expect, test } from './support/app.ts';
import { restoreSeed } from './support/restore.ts';

/** Make the first card of each type due now (raw IndexedDB, before the app reads it). */
async function makeDue(page: Page, types: string[]) {
  await page.evaluate(async (wanted) => {
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
    for (const type of wanted) {
      const card = all.find((c) => c.card_type === type && c.deleted_at === null && c.state === 2);
      if (card) store.put({ ...card, due: Date.now() - 60_000, unlocked: true, suspended: false });
    }
    await new Promise((res) => (tx.oncomplete = res));
    db.close();
  }, types);
}

test('study modes: separate sessions, typed Üretim answer above the keyboard, cloze choices', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await restoreSeed(page, 150);
  await makeDue(page, ['production', 'cloze']);

  // The picker lists the three types with their cards.
  await page.goto('/study');
  const production = page.getByTestId('study-mode-production');
  await expect(production).toHaveAttribute('href', '/study?mode=production');
  await expect(page.getByTestId('study-mode-cloze')).toBeVisible();
  await expect(page.getByTestId('study-mode-word')).toBeVisible();

  // Üretim: a typed answer. With the keyboard open (a shorter viewport) the field and its
  // button stay on screen, above the keyboard.
  await page.goto('/study?mode=production');
  const input = page.getByTestId('answer-input');
  await expect(input).toBeVisible();
  await expect(page.locator('[data-card-type]')).toHaveAttribute('data-card-type', /production|image/);
  await page.setViewportSize({ width: 390, height: 480 });
  await expect
    .poll(async () => {
      const box = await page.getByRole('button', { name: 'Kontrol et' }).boundingBox();
      return box ? box.y + box.height : Infinity;
    })
    .toBeLessThanOrEqual(480);
  await input.fill('zzzz');
  await input.press('Enter');
  await expect(page.getByText('Bu sefer olmadı')).toBeVisible();
  await expect(page.getByText(/Önerimiz:/)).toContainText('Tekrar');
  // The rating bar is fixed at the bottom while the result scrolls.
  const bar = page.getByRole('group', { name: /Ne kadar iyi hatırladın\?/ });
  const barBox = await bar.boundingBox();
  expect(barBox!.y + barBox!.height).toBeLessThanOrEqual(480);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('body').press('1');

  // Boşluk doldurma: pick a choice, check, rate.
  await page.goto('/study?mode=cloze');
  await expect(page.locator('[data-card-type="cloze"]')).toBeVisible();
  const choices = page.getByRole('group', { name: 'Seçenekler' }).getByRole('button');
  await expect(choices).toHaveCount(4);
  await choices.first().click();
  await page.getByRole('button', { name: 'Kontrol et' }).click();
  await expect(page.getByText(/Önerimiz:/)).toBeVisible();
  await page.locator('body').press('3');

  // Kelime çalışma shows recognition cards only.
  await page.goto('/study?mode=word');
  const showAnswer = page.getByRole('button', { name: 'Cevabı göster', disabled: false });
  await expect(showAnswer.or(page.getByRole('heading', { level: 2 })).first()).toBeVisible();
  if (await showAnswer.isVisible())
    await expect(page.locator('[data-card-type]')).toHaveAttribute('data-card-type', 'recognition');
});
