import { addWord, expect, reviewAll, test, WORDS } from './support/app.ts';
import { FakeBackend } from './support/backend.ts';

// Real conditions: the service worker serves the app shell and lazy route chunks offline.
test.use({ serviceWorkers: 'allow' });

// Acceptance criterion 2: in airplane mode review, adding cards and the streak panel work; when
// the connection returns, sync completes within a minute and no review log is lost.
test('offline: review, add a card and open stats; back online the outbox is pushed within 60 s', async ({
  page,
  context,
  backend,
}) => {
  await FakeBackend.signIn(context);
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload(); // now controlled by the worker
  await page.goto('/add');
  await expect(page.getByRole('status', { name: 'Senkron durumu: Senkronlandı' })).toBeVisible();
  for (const w of WORDS.slice(0, 2)) await addWord(page, w);
  await expect.poll(() => backend.pushedIds('notes').length, { timeout: 15_000 }).toBe(2);
  await page.goto('/');
  await expect(page.getByTestId('start-study')).toBeVisible();

  // Airplane mode.
  backend.offline = true;
  await context.setOffline(true);
  await expect(page.getByRole('status', { name: /Senkron durumu: Çevrimdışı/ })).toBeVisible();

  await page.getByTestId('start-study').click();
  const reviewed = await reviewAll(page, '3');
  expect(reviewed).toBeGreaterThan(0);
  await expect(page.getByRole('heading', { name: 'Oturum tamamlandı' })).toBeVisible();

  await page.getByRole('link', { name: 'Ana ekrana dön' }).click();
  await page.getByRole('button', { name: 'Ekle', exact: true }).first().click();
  await page.getByRole('dialog', { name: 'Ne eklemek istersin?' }).getByTestId('add-way-word').click();
  await expect(page).toHaveURL(/\/add$/);
  await addWord(page, WORDS[2]!);

  await page.getByRole('link', { name: 'İlerleme' }).first().click();
  await expect(page.getByRole('heading', { name: 'İstatistik', level: 1 })).toBeVisible();
  await expect(page.getByText('Güncel seri')).toBeVisible();
  await expect(page.getByRole('grid', { name: /Günlük tekrar takvimi/ })).toBeVisible();

  const localLogs: string[] = await page.evaluate(async () => {
    const open = indexedDB.open('engapp');
    const db: IDBDatabase = await new Promise((res, rej) => {
      open.onsuccess = () => res(open.result);
      open.onerror = () => rej(open.error);
    });
    const tx = db.transaction('review_logs', 'readonly');
    const req = tx.objectStore('review_logs').getAllKeys();
    const keys = await new Promise<IDBValidKey[]>((res) => (req.onsuccess = () => res(req.result)));
    db.close();
    return keys.map(String);
  });
  expect(localLogs.length).toBe(reviewed);
  expect(backend.pushedIds('review_logs')).toHaveLength(0);

  // Connection back.
  const back = Date.now();
  backend.offline = false;
  await context.setOffline(false);
  await expect
    .poll(() => backend.pushedIds('review_logs').sort(), { timeout: 60_000, intervals: [250] })
    .toEqual([...localLogs].sort());
  const elapsed = Date.now() - back;
  expect(backend.pushedIds('notes')).toHaveLength(3);
  test.info().annotations.push({ type: 'sync-after-online-ms', description: String(elapsed) });
  console.log(`offline → online: ${localLogs.length} review logs pushed in ${elapsed} ms`);
  await expect(page.getByRole('status', { name: 'Senkron durumu: Senkronlandı' })).toBeVisible({
    timeout: 15_000,
  });
});
