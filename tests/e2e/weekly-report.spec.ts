// v0.3 İP7: the weekly report on a 360 px phone. Offline, the numbers are there at once and the
// screen says the comment comes later; online, the real ai-report pipeline (FakeBackend, scripted
// model) adds the comment. Only numbers and fixed names are sent; the report syncs once.
import { FakeBackend } from './support/backend.ts';
import { expect, test } from './support/app.ts';
import { restoreSeed } from './support/restore.ts';

const SHOTS = process.env.E2E_SHOTS_DIR;

test.beforeEach(async ({ context }) => {
  await FakeBackend.signIn(context);
});

test('weekly report: numbers offline, comment once online, synced once', async ({
  page,
  backend,
}) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await restoreSeed(page, 300);

  // Offline: the report is made from the device's numbers alone.
  backend.offline = true;
  await page.goto('/progress?tab=rapor');
  const report = page.getByRole('region', { name: 'Geçen haftanın raporu' });
  await expect(report).toBeVisible({ timeout: 20_000 });
  await expect(report.getByText('Çalıştığın gün')).toBeVisible();
  await expect(report.getByText(/^\d \/ 7$/)).toBeVisible();
  await expect(report.getByTestId('report-comment-missing')).toHaveText(
    'Yorum, internete bağlanınca eklenecek. Sayılar şimdiden hazır.',
  );
  await expect(report.getByTestId('report-focus').getByRole('heading')).toHaveText(
    'Bu haftaki önerimiz',
  );
  expect(backend.count('ai-report')).toBe(0);

  // No horizontal scrolling at 360 px.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // Back online: the comment is added to the same report.
  backend.offline = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  const comment = report.getByTestId('report-comment');
  await expect(comment).toContainText('Düzenli tekrar etmen kelimeleri kalıcı yapıyor.', {
    timeout: 20_000,
  });
  // The sentence with a number the app never computed was dropped by the server.
  await expect(comment).not.toContainText('9999');
  await expect(report.getByText(/Yorumu yapay zekâ yazdı/)).toBeVisible();
  if (SHOTS) {
    await page.screenshot({ path: `${SHOTS}/report-light.png`, fullPage: true });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({ path: `${SHOTS}/report-dark.png`, fullPage: true });
    await page.emulateMedia({ colorScheme: 'light' });
  }

  // The request holds numbers and fixed names only: no word, meaning or sentence of the user.
  const body = backend.calls.find((c) => c.name === 'ai-report')!.body as Record<string, unknown>;
  expect(Object.keys(body).sort()).toEqual(
    [
      'active_days',
      'focus',
      'goals',
      'groups_days',
      'minutes',
      'new_learned',
      'retention_pct',
      'reviews',
      'streak_days',
      'strongest',
      'weakest',
      'week',
    ].sort(),
  );
  const text = JSON.stringify(body);
  for (const w of ['reluctant', 'thrive', 'People say', 'anlam']) expect(text).not.toContain(w);

  // One report per week reaches the server.
  await expect.poll(() => backend.pushedIds('weekly_reports').length, { timeout: 20_000 }).toBe(1);
  await page.reload();
  await expect(
    page.getByRole('region', { name: 'Geçen haftanın raporu' }).getByTestId('report-comment'),
  ).toBeVisible();
  expect(backend.count('ai-report')).toBe(1);

  // Goals on the Genel tab: set one with the suggestion, see its ring.
  await page.getByRole('tab', { name: 'Genel' }).click();
  const goals = page.getByRole('region', { name: 'Hedeflerin' });
  await goals.getByRole('button', { name: 'Hedef koy' }).click();
  const dialog = page.getByRole('dialog', { name: 'Hedeflerin' });
  await dialog.getByRole('button', { name: 'Öneriyi kullan: Haftada çalışma günü' }).click();
  await dialog.getByRole('button', { name: 'Kaydet' }).click();
  await expect(
    goals.getByRole('img', { name: /^Bu hafta çalıştığın gün: \d+ \/ \d gün$/ }),
  ).toBeVisible();
  if (SHOTS) {
    await page.screenshot({ path: `${SHOTS}/goals-light.png`, fullPage: true });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({ path: `${SHOTS}/goals-dark.png`, fullPage: true });
  }
});
