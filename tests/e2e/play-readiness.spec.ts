/**
 * Google Play readiness (v0.4 İP7, ADR 0035): the public pages work without an account and
 * pass axe, and account deletion (function mocked) and the guest device wipe leave nothing
 * on the device.
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { addWord, expect, test, WORDS } from './support/app.ts';
import { FakeBackend, SUPABASE_URL } from './support/backend.ts';

async function axe(page: Page, what: string) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
    what,
  ).toEqual([]);
}

async function localCount(page: Page, table: string): Promise<number> {
  return page.evaluate(async (t) => {
    const open = indexedDB.open('engapp');
    const db: IDBDatabase = await new Promise((res, rej) => {
      open.onsuccess = () => res(open.result);
      open.onerror = () => rej(open.error);
    });
    const req = db.transaction(t, 'readonly').objectStore(t).count();
    const n = await new Promise<number>((res) => (req.onsuccess = () => res(req.result)));
    db.close();
    return n;
  }, table);
}

/** Mocks POST /functions/v1/account-delete (registered after the fake backend, so it wins). */
async function mockDeleteFunction(page: Page, status = 200) {
  const calls: { auth: string | null; body: unknown }[] = [];
  await page.context().route(`${SUPABASE_URL}/functions/v1/account-delete`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204 });
    calls.push({ auth: req.headers()['authorization'] ?? null, body: req.postDataJSON() });
    return route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(
        status === 200
          ? { deleted: true, account: 'deleted', rows: { notes: 1 }, files: 0 }
          : { error: { code: 'internal', message: 'Internal error' } },
      ),
    });
  });
  return calls;
}

test.describe('public pages, signed out', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`/gizlilik, /privacy and /hesap-sil load directly and pass axe (${scheme})`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 360, height: 780 });

      await page.goto('/gizlilik');
      await expect(page.getByRole('heading', { level: 1, name: 'Gizlilik politikası' })).toBeVisible();
      await expect(page.getByRole('heading', { name: /Haklarına \(KVKK m\. 11\)/ })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
      // No app navigation on a public page.
      await expect(page.getByRole('navigation', { name: 'Ana gezinme' })).toHaveCount(0);
      await axe(page, `gizlilik ${scheme}`);

      await page.getByRole('link', { name: 'Privacy policy (English)' }).click();
      await expect(page).toHaveURL(/\/privacy$/);
      await expect(page.getByRole('heading', { level: 1, name: 'Privacy policy' })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await axe(page, `privacy ${scheme}`);

      await page.goto('/hesap-sil');
      await expect(
        page.getByRole('heading', { level: 1, name: 'Hesabını ve verilerini sil' }),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: 'Google ile giriş yap' })).toBeVisible();
      await axe(page, `hesap-sil ${scheme}`);
    });
  }

  test('Settings → Hakkında links to the privacy policy', async ({ page }) => {
    await page.goto('/settings');
    await page.getByRole('link', { name: /Gizlilik politikası/ }).click();
    await expect(page).toHaveURL(/\/gizlilik$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Gizlilik politikası' })).toBeVisible();
  });
});

test('signed in: Ayarlar → Hesap → "Hesabımı ve verilerimi sil" deletes the account, wipes the device and signs out', async ({
  page,
  context,
  backend,
}) => {
  const calls = await mockDeleteFunction(page);
  await FakeBackend.signIn(context);
  await page.goto('/add');
  await expect(page.getByRole('status', { name: 'Senkron durumu: Senkronlandı' })).toBeVisible();
  await addWord(page, WORDS[0]!);
  await expect.poll(() => backend.pushedIds('notes').length, { timeout: 15_000 }).toBe(1);

  await page.goto('/settings');
  await page.getByRole('button', { name: 'Hesabı sil' }).click();
  const dialog = page.getByRole('dialog', { name: 'Hesabın ve verilerin silinsin mi?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'JSON yedeğini indir' })).toBeVisible();
  const confirm = dialog.getByRole('button', { name: 'Hesabımı kalıcı olarak sil' });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('Onaylamak için SİL yaz').fill('SİL');
  await confirm.click();

  await expect(page).toHaveURL(/\/hesap-sil\?durum=silindi$/);
  await expect(page.getByRole('heading', { name: 'Hesabın ve verilerin silindi' })).toBeVisible();
  expect(calls).toHaveLength(1);
  expect(calls[0]!.auth).toMatch(/^Bearer /);
  expect(calls[0]!.body).toEqual({ confirm: 'delete-my-account-and-data' });
  // (The fresh start after the reload recreates default settings, so only user data is checked.)
  for (const t of ['notes', 'senses', 'cards', 'review_logs', 'sources'])
    expect(await localCount(page, t), t).toBe(0);

  // Signed out, an empty guest app.
  await page.getByRole('link', { name: 'Uygulamaya dön' }).first().click();
  await expect(page.getByRole('link', { name: /Senkron durumu: Misafir modu/ })).toBeVisible();
  await page.goto('/library');
  await expect(page.getByRole('list', { name: 'Notlar' })).toHaveCount(0);
});

test('signed in: a failed deletion keeps everything and says so', async ({ page, context, backend }) => {
  await mockDeleteFunction(page, 500);
  await FakeBackend.signIn(context);
  await page.goto('/add');
  await expect(page.getByRole('status', { name: 'Senkron durumu: Senkronlandı' })).toBeVisible();
  await addWord(page, WORDS[1]!);
  await expect.poll(() => backend.pushedIds('notes').length, { timeout: 15_000 }).toBe(1);

  await page.goto('/settings');
  await page.getByRole('button', { name: 'Hesabı sil' }).click();
  const dialog = page.getByRole('dialog', { name: 'Hesabın ve verilerin silinsin mi?' });
  await dialog.getByLabel('Onaylamak için SİL yaz').fill('sil');
  await dialog.getByRole('button', { name: 'Hesabımı kalıcı olarak sil' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Silme tamamlanamadı');
  await expect(page).toHaveURL(/\/settings$/);
  expect(await localCount(page, 'notes')).toBe(1);
});

test('guest: "Bu cihazdaki verileri sil" wipes only this device', async ({ page, backend }) => {
  const calls = await mockDeleteFunction(page);
  await addWord(page, WORDS[2]!);
  expect(await localCount(page, 'notes')).toBe(1);

  await page.goto('/settings');
  await page.getByRole('button', { name: 'Verileri sil' }).click();
  const dialog = page.getByRole('dialog', { name: 'Bu cihazdaki veriler silinsin mi?' });
  await dialog.getByLabel('Onaylamak için SİL yaz').fill('SIL'); // a keyboard without İ
  await dialog.getByRole('button', { name: 'Bu cihazdaki verileri sil' }).click();

  await expect(page).toHaveURL(/\/hesap-sil\?durum=cihaz$/);
  await expect(page.getByRole('heading', { name: 'Bu cihazdaki veriler silindi' })).toBeVisible();
  expect(await localCount(page, 'notes')).toBe(0);
  expect(calls).toHaveLength(0);
  expect(backend.calls).toHaveLength(0); // a guest never reaches the server
});
