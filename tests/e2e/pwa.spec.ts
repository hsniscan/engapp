import { addWord, expect, test, WORDS } from './support/app.ts';

test.describe('PWA', () => {
  test.use({ serviceWorkers: 'allow' });

  test('service worker registers, precaches the app and the app reloads offline (every route)', async ({
    page,
    context,
  }) => {
    await page.goto('/');
    const sw = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      return { scope: reg.scope, script: reg.active?.scriptURL ?? null };
    });
    expect(sw.scope).toMatch(/\/$/);
    expect(sw.script).toMatch(/\/sw\.js$/);
    await expect(
      page.getByText('Engapp artık internetsiz de çalışır', { exact: true }),
    ).toBeVisible();

    // Manifest: what installability needs.
    const manifest = await (await page.request.get('/manifest.webmanifest')).json();
    expect(manifest).toMatchObject({ display: 'standalone', start_url: '/', lang: 'tr' });
    const sizes = (manifest.icons as { sizes: string; purpose: string }[]).map(
      (i) => `${i.sizes}:${i.purpose}`,
    );
    expect(sizes).toEqual(
      expect.arrayContaining(['192x192:any', '512x512:any', '512x512:maskable']),
    );

    await page.reload(); // controlled from now on
    await addWord(page, WORDS[0]!);

    await context.setOffline(true);
    for (const [path, heading] of [
      ['/progress', 'İstatistik'],
      ['/library', 'Kartlar'],
      ['/add', 'Kart ekle'],
      ['/stats', 'İstatistik'],
      ['/settings', 'Ayarlar'],
      ['/more', 'Biraz daha çalış'],
      ['/study', 'Biraz daha çalış'],
    ] as const) {
      await page.goto(path);
      await expect(
        page.getByRole('heading', { name: heading, level: 1, exact: true }),
      ).toBeVisible();
    }
    await page.goto('/');
    await expect(page.getByTestId('today-hero')).toBeVisible();
    await page.goto('/review');
    await expect(page).toHaveURL(/\/study\?mode=word$/);
    await expect(page.getByRole('button', { name: 'Cevabı göster' })).toBeEnabled();
    // Extra study works in airplane mode too: answer the card, then practice it.
    await page.locator('body').press('Space');
    await page.locator('body').press('4');
    await expect(page.getByRole('heading', { name: 'Oturum tamamlandı' })).toBeVisible();
    await page.goto('/practice?source=recent&size=10');
    await expect(page.getByRole('button', { name: 'Cevabı göster' })).toBeEnabled();
    await context.setOffline(false);
  });
});

test('a screen whose code cannot be downloaded shows a friendly error inside the shell', async ({
  page,
}) => {
  await page.goto('/');
  await page.route(/\/assets\/DecksPage-.*\.js$/, (r) => r.abort('internetdisconnected'));
  await page.getByRole('link', { name: 'Desteler' }).first().click();
  await expect(page.getByRole('heading', { name: 'Bu ekran yüklenemedi', level: 2 })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Ana gezinme' }).first()).toBeVisible();
  await page.unroute(/\/assets\/DecksPage-.*\.js$/);
  await page.getByRole('button', { name: 'Sayfayı yenile' }).click();
  await expect(page.getByRole('heading', { name: 'Desteler', level: 1 })).toBeVisible();
});
