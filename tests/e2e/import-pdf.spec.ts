import { FAKE_SPECS } from '../../src/features/import/testing/fakeSpecs.ts';
import { expect, test } from './support/app.ts';
import { FakeBackend } from './support/backend.ts';
import { imageOnlyPdf, textPdf } from './support/pdf.ts';

const ascii = FAKE_SPECS.filter((s) => /^[\x20-\x7e]+$/.test(s.sentence)).slice(0, 9);

test.beforeEach(async ({ context, page, backend }) => {
  void backend; // installs the mocked Supabase routes
  await FakeBackend.signIn(context);
  await page.goto('/add?tab=pdf');
  await expect(page.getByRole('status', { name: 'Senkron durumu: Senkronlandı' })).toBeVisible();
});

async function pick(page: import('@playwright/test').Page, name: string, buffer: Buffer) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Dosya seç' }).click();
  await (await chooser).setFiles({ name, mimeType: 'application/pdf', buffer });
}

test('text PDF (3 pages) → read with pdf.js → candidates → preview', async ({ page, backend }) => {
  const pages = [ascii.slice(0, 3), ascii.slice(3, 6), ascii.slice(6, 9)].map((g, i) => [
    'Weekly Review - City Desk', // repeated header: removed
    ...g.map((s) => s.sentence),
    `Page ${i + 1}`, // repeated footer: removed
  ]);
  await pick(page, 'haber.pdf', textPdf(pages));
  await expect(page.getByText(/^3 sayfa · [\d.]+ karakter · 1 parça$/)).toBeVisible();
  await page.getByRole('button', { name: 'Kelimeleri çıkar' }).click();
  // v0.5.1: the PDF's text is saved first and the extraction opens its preview.
  await expect(page).toHaveURL(/\/import\//);
  await expect(page.getByTestId('smart-summary')).toBeVisible();
  await expect(page.getByTestId('read-text')).toBeVisible();
  expect(backend.count('ai-extract')).toBe(1);
  const sent = (backend.calls.find((c) => c.name === 'ai-extract')!.body as { text: string }).text;
  expect(sent).not.toContain('Weekly Review');
  expect(sent).not.toMatch(/Page \d/);
  await expect(page.getByTestId('smart-summary')).toContainText(`bu metinde ${ascii.length} aday`);
});

test('scanned PDF (no text layer) → friendly message, nothing is sent', async ({
  page,
  backend,
}) => {
  await pick(page, 'taranmis.pdf', imageOnlyPdf(2));
  await expect(page.getByText("Bu PDF'te okunabilir metin yok")).toBeVisible();
  await expect(page.getByText(/Taranmış \(görüntü\) PDF'ler henüz desteklenmiyor/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Kelimeleri çıkar' })).toHaveCount(0);
  expect(backend.count('ai-extract')).toBe(0);
});

test('not a PDF → clear error', async ({ page }) => {
  await pick(page, 'notlar.pdf', Buffer.from('just some text, not a pdf'));
  await expect(page.getByText('Bu dosya bir PDF değil.').first()).toBeVisible();
});

test.describe('pdf.js worker cache', () => {
  test.use({ serviceWorkers: 'allow' });

  // docs/decisions/0008: the 1.26 MB worker is not precached; it is cached on first use.
  test('not precached; offline before the first PDF → clear error; cached after first use', async ({
    page,
    context,
  }) => {
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload(); // controlled
    const cached = () =>
      page.evaluate(async () => {
        const urls: string[] = [];
        for (const name of await caches.keys()) {
          for (const r of await (await caches.open(name)).keys()) urls.push(`${name} ${r.url}`);
        }
        return urls.filter((u) => /pdf\.worker[^/]*\.mjs/.test(u));
      });
    expect(await cached()).toEqual([]);
    const pdf = textPdf([ascii.slice(0, 3).map((s) => s.sentence)]);

    await context.setOffline(true);
    await pick(page, 'haber.pdf', pdf);
    await expect(
      page.getByRole('alert').filter({ hasText: 'PDF okuyucu indirilemedi' }),
    ).toBeVisible();
    await context.setOffline(false);

    await page.reload();
    await pick(page, 'haber.pdf', pdf);
    await expect(page.getByText(/^1 sayfa · [\d.]+ karakter · 1 parça$/)).toBeVisible();
    expect((await cached()).join()).toContain('engapp-pdf-worker');

    await context.setOffline(true);
    await page.reload();
    await pick(page, 'haber.pdf', pdf);
    await expect(page.getByText(/^1 sayfa · [\d.]+ karakter · 1 parça$/)).toBeVisible();
    await context.setOffline(false);
  });
});
