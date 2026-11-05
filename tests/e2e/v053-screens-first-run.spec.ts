// v0.5.3 (ADR 0072): screenshots of the screens agent U changed, at 390 px, light and dark:
// the welcome, the deck step while its deck goes in, the level test opened from the onboarding,
// Bugün while only learning steps wait ("Beklerken"), Profil's storage notice, a returning
// learner's Bugün (one note below the card) and Kelimelerim. Runs only with SHOTS_DIR=<dir>.
import type { Page } from '@playwright/test';
import { expect, reviewAll, test } from './support/app.ts';
import { restoreSeed } from './support/restore.ts';
import { referenceBankRows, serveWordBank } from './support/wordBankSeed.ts';

const SHOTS = process.env.SHOTS_DIR;
test.skip(!SHOTS, 'screenshots only (SHOTS_DIR)');
test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

async function shot(page: Page, name: string, full = false) {
  const by = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(by, `${name}: sideways scroll`).toBeLessThanOrEqual(0);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.waitForTimeout(250);
    await page.screenshot({
      path: `${SHOTS}/${name}-${scheme === 'light' ? 'acik' : 'koyu'}.png`,
      fullPage: full,
    });
  }
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
}

/** A browser that does not agree to keep the data (as most do for a new site). */
async function persistDenied(page: Page) {
  await page.addInitScript(() => {
    const s = navigator.storage;
    if (s) {
      Object.defineProperty(s, 'persist', { value: async () => false });
      Object.defineProperty(s, 'persisted', { value: async () => false });
    }
  });
}

test.describe('first run', () => {
  test.use({ firstRun: true });

  test('welcome, deck step, first session, Beklerken, Profil', async ({ page }) => {
    test.setTimeout(300_000);
    await persistDenied(page);
    await serveWordBank(page, referenceBankRows());
    await page.goto('/');
    await expect(page.getByTestId('onboarding-welcome')).toBeVisible();
    await shot(page, '01-karsilama', true);

    await page.getByRole('button', { name: 'Başlayalım' }).click();
    await page.getByRole('button', { name: 'Teste başla' }).click();
    await expect(page.getByRole('button', { name: 'Biliyorum' })).toBeVisible({ timeout: 20_000 });
    for (let i = 0; i < 5; i++) {
      const known = page.getByRole('button', { name: 'Biliyorum', exact: true });
      if (!(await known.isVisible())) break;
      await known.click();
      await page.waitForTimeout(150);
    }
    await shot(page, '02-seviye-testi-soru');

    // Back to the flow (the test is not finished: the onboarding goes on with interests).
    await page.goto('/');
    const interests = page.getByTestId('onboarding-interests');
    await interests.getByRole('button', { name: 'Seyahat' }).click();
    await interests.getByRole('button', { name: '1 konuyla devam et' }).click();
    const deck = page.getByTestId('onboarding-deck');
    await expect(deck.getByRole('radio', { name: /En çok kullanılan 500 kelime/ })).toBeChecked();
    await deck.getByRole('button', { name: 'Bu desteyle ilk çalışmaya başla' }).click();
    const adding = page.getByTestId('onboarding-deck-adding');
    if (await adding.isVisible().catch(() => false)) {
      await page.screenshot({ path: `${SHOTS}/03-deste-ekleniyor-acik.png` }).catch(() => {});
    }
    await expect(page).toHaveURL(/\/study\?mode=word$/, { timeout: 60_000 });
    const answered = await reviewAll(page, '3');
    expect(answered).toBeGreaterThan(0);

    await page.goto('/');
    await expect(page.getByTestId('while-waiting')).toBeVisible({ timeout: 20_000 });
    await shot(page, '04-bugun-beklerken', true);

    await page.goto('/profile');
    await expect(page.getByTestId('storage-notice')).toBeVisible();
    await shot(page, '05-profil-depolama-notu');
  });
});

test('returning learner: Bugün with one note below the card, Kelimelerim', async ({ page }) => {
  test.setTimeout(400_000);
  await serveWordBank(page, referenceBankRows());
  await restoreSeed(page, 300);
  await page.goto('/');
  await expect(page.getByTestId('today-hero')).toBeVisible();
  await expect(page.getByTestId('home-notes')).toBeVisible({ timeout: 20_000 });
  await shot(page, '06-bugun-donus', true);
  const hero = await page.getByTestId('today-hero').textContent();
  await page.goto('/decks');
  await expect(page.getByTestId('mine-all-today')).toBeVisible();
  await shot(page, '07-kelimelerim');
  const ring = /(\d+)\s*kart kaldı/.exec(hero ?? '')?.[1];
  if (ring) await expect(page.getByTestId('mine-all-today')).toContainText(`${ring} kart bugün`);
});
