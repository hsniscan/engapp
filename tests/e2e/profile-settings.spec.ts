import { expect, test } from './support/app.ts';

// v0.5.1 "Toparlama", İlerleme / Profil / Ayarlar: what a brand-new guest sees on each screen
// the review found wrong (docs/decisions/0058).

test('privacy and account deletion never show a missing-address placeholder', async ({ page }) => {
  await page.goto('/gizlilik');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText('iletişim adresi henüz eklenmedi')).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: 'github.com/hsniscan/engapp/issues' }).first(),
  ).toHaveAttribute('href', 'https://github.com/hsniscan/engapp/issues');

  await page.goto('/hesap-sil');
  await expect(page.getByText('iletişim adresi henüz eklenmedi')).toHaveCount(0);
  await expect(
    page.getByText(/Profil → ⚙ Ayarlar → Hesap ve eşitleme → Hesabımı ve verilerimi sil/),
  ).toBeVisible();
});

test('reminders for a web guest: a sign-in button, no dead end', async ({ page }) => {
  await page.goto('/settings/bildirim');
  await expect(page.getByText(/Bildirimler Google hesabıyla çalışır/)).toBeVisible();
  await expect(page.getByText(/Yukarıdaki Hesap/)).toHaveCount(0);
  // The web has no home-screen widgets: no widget card.
  await expect(page.getByText('Ana ekran araçları')).toHaveCount(0);
  await page.getByRole('link', { name: 'Giriş yap', exact: true }).click();
  await expect(page).toHaveURL(/\/auth$/);
});

test('İlerleme for a new user: one first-steps card and the calendar, no wall of zeros', async ({
  page,
}) => {
  await page.goto('/progress');
  const first = page.getByTestId('progress-first-steps');
  await expect(first.getByRole('heading', { name: 'İlk çalışmanı yap' })).toBeVisible();
  await expect(first.getByText('Haftalık rapor')).toBeVisible();
  await expect(first.getByText('Çalıştığın ilk haftadan sonraki pazartesi')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Devamlılık' })).toBeVisible();
  await expect(page.getByTestId('hard-tile')).toHaveCount(0);
  await expect(page.getByText('Önümüzdeki 30 gün', { exact: true })).toHaveCount(0);
});

test('Profil: an unmeasured level is not shown as B1; stats live on İlerleme', async ({ page }) => {
  await page.goto('/profile');
  const level = page.getByTestId('profile-level');
  await expect(level).toHaveText('Henüz ölçülmedi');
  await expect(page.getByRole('link', { name: 'Teste başla' })).toHaveAttribute(
    'href',
    '/level-test',
  );
  // No streak / goals duplicates here.
  await expect(page.getByRole('heading', { name: 'Hedeflerin' })).toHaveCount(0);
  // Plain words for a guest.
  await expect(page.getByText('Eşitleme', { exact: true })).toBeVisible();
  await expect(page.getByText('Senkron')).toHaveCount(0);
});

test('Ayarlar: plain words and the 0.5.1 version', async ({ page }) => {
  await page.goto('/settings/veri');
  await expect(page.getByText('Verileri tarayıcıda koru')).toBeVisible();
  await expect(page.getByText('Kalıcı depolama')).toHaveCount(0);
  await page.goto('/settings/gelismis');
  await expect(page.getByText('Veri denetimi')).toBeVisible();
  await expect(page.getByText('0.5.1')).toBeVisible();
  await page.goto('/settings/kartlar');
  await expect(page.getByRole('heading', { name: 'Profil' })).toHaveCount(0);
});
