// Redesign integration: the study screen's bottom bar (show answer, typed answer, the four
// rating buttons) stays fixed and fully on screen for every study type, on a tall and a short
// phone; and every place of the five-place nav, the (+) Add sheet and the old addresses work.
import type { Page } from '@playwright/test';
import { expect, test } from './support/app.ts';
import { restoreSeed } from './support/restore.ts';

/** Make the first review card of each type due now (raw IndexedDB, before the app reads it). */
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

/** The rating group sits wholly inside the viewport, below the card, and nothing scrolls sideways. */
async function ratingBarOnScreen(page: Page, label: string) {
  const group = page.getByRole('group', { name: /Ne kadar iyi hatırladın\?/ });
  await expect(group, label).toBeVisible();
  const vp = page.viewportSize()!;
  const box = (await group.boundingBox())!;
  expect(box.y, label).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height, label).toBeLessThanOrEqual(vp.height);
  // Every button is tappable where it is drawn (nothing on top of it).
  for (const button of await group.getByRole('button').all()) {
    const b = (await button.boundingBox())!;
    const hit = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x!, y!)?.closest('button')?.textContent ?? null,
      [b.x + b.width / 2, b.y + b.height / 2],
    );
    expect(hit, `${label}: ${await button.textContent()}`).toBe(await button.textContent());
  }
  // The card's scrolling region ends where the bar begins (the bar never covers the card).
  const region = await page
    .getByTestId('study-frame')
    .locator('[role="region"]')
    .first()
    .boundingBox();
  if (region) expect(region.y + region.height, label).toBeLessThanOrEqual(box.y + 1);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
    label,
  ).toBeLessThanOrEqual(vp.width);
  // The page itself does not scroll: the bar is fixed, the card scrolls inside the frame.
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight),
    label,
  ).toBeLessThanOrEqual(1);
}

for (const height of [844, 600]) {
  test(`study: the rating bar stays on screen at 390×${height} for word, production and cloze`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 390, height });
    await restoreSeed(page, 150);
    await makeDue(page, ['production', 'cloze']);

    await page.goto('/study?mode=word');
    await page.getByRole('button', { name: 'Cevabı göster', disabled: false }).click();
    await ratingBarOnScreen(page, `word ${height}`);

    await page.goto('/study?mode=production');
    await expect(page.getByTestId('answer-input')).toBeVisible();
    await page.getByRole('button', { name: 'Bilmiyorum, göster' }).click();
    await ratingBarOnScreen(page, `production ${height}`);

    await page.goto('/study?mode=cloze');
    await expect(page.getByTestId('study-front')).toBeVisible();
    const choices = page.getByRole('group', { name: 'Seçenekler' }).getByRole('button');
    await expect(choices.first().or(page.getByTestId('answer-input'))).toBeVisible();
    if (await choices.count()) await choices.first().click();
    else await page.getByTestId('answer-input').fill('x');
    await page.getByRole('button', { name: 'Kontrol et' }).click();
    await ratingBarOnScreen(page, `cloze ${height}`);
  });
}

test('nav: every place, the (+) Add sheet and the old addresses', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Ana gezinme' }).first();
  for (const [name, url, heading] of [
    ['Kelimelerim', /\/decks$/, 'Kelimelerim'],
    ['Keşfet', /\/kesfet$/, 'Keşfet'],
    ['Profil', /\/profile$/, 'Misafir'],
    ['Bugün', /\/$/, null],
  ] as const) {
    await nav.getByRole('link', { name, exact: true }).click();
    await expect(page).toHaveURL(url);
    await expect(nav.getByRole('link', { name, exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    if (heading)
      await expect(
        page.getByRole('heading', { level: 1, name: heading, exact: true }),
      ).toBeVisible();
  }
  await expect(
    page
      .getByTestId('today-hero')
      .or(page.getByTestId('today-hero-done'))
      .or(page.getByRole('heading', { level: 1 }))
      .first(),
  ).toBeVisible();

  // (+): a sheet over the current screen, not a route; Escape closes it.
  await nav.getByRole('button', { name: 'Ekle' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();

  for (const [from, to] of [
    ['/review', /\/study\?mode=word$/],
    ['/review?mode=ahead', /\/study\?mode=ahead$/],
    ['/more', /\/study\/more$/],
    ['/stats', /\/progress$/],
    ['/stats?tab=rapor', /\/progress\?tab=rapor$/],
    ['/kelime-bankasi', /\/decks\?tab=bank$/],
    ['/kitaplik', /\/kesfet\?f=okuma$/],
    ['/decks?tab=discover', /\/kesfet\?f=desteler$/],
    ['/decks?tab=reading', /\/kesfet\?f=okuma$/],
    ['/settings/profile', /\/settings\/ilgi-alanlari$/],
    ['/settings#veri', /\/settings\/veri(#veri)?$/],
  ] as const) {
    await page.goto(from);
    await expect(page, from).toHaveURL(to);
    await expect(page.getByRole('heading', { level: 1 }).first(), from).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Bu ekran yüklenemedi' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Bir şeyler ters gitti' })).toHaveCount(0);
  }
});
