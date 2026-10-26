import type { Page } from '@playwright/test';
import { addWord, expect, test, WORDS } from './support/app.ts';
import { FakeBackend } from './support/backend.ts';

const PROMPT = 'Hangi konular ilgini çekiyor?';

/** Three imported texts about technology, written straight into IndexedDB (as a pull would). */
async function addTechTexts(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const open = indexedDB.open('engapp');
    const db: IDBDatabase = await new Promise((res, rej) => {
      open.onsuccess = () => res(open.result);
      open.onerror = () => rej(open.error);
    });
    const tx = db.transaction('sources', 'readwrite');
    const now = Date.now();
    for (let i = 1; i <= 3; i++) {
      tx.objectStore('sources').put({
        id: `0199aaaa-0000-7000-8000-00000000000${i}`,
        user_id: null,
        kind: 'text',
        title: `Tech article ${i}`,
        file_name: null,
        page_count: null,
        topics: ['technology'],
        created_at: now - i * 86_400_000,
        updated_at: now,
        deleted_at: null,
        hlc: `${String(now).padStart(15, '0')}:0000${i}:e2e`,
      });
    }
    await new Promise((res) => (tx.oncomplete = res));
    db.close();
  });
}

// İP7: the interests question shows once on the dashboard, the answer syncs (a second device
// does not ask again), and Ayarlar → Profil shows weights with their reasons.
test('interests: pick on the home screen, see why in the profile, turn a topic off, second device', async ({
  page,
  context,
  browser,
  backend,
}) => {
  await FakeBackend.signIn(context);
  await addWord(page, WORDS[0]!);
  await page.goto('/');
  const prompt = page.getByRole('region', { name: PROMPT });
  await expect(prompt).toBeVisible();
  await expect(page.getByTestId('start-study')).toBeVisible(); // nothing blocked
  await prompt.getByRole('button', { name: 'Teknoloji' }).click();
  await prompt.getByRole('button', { name: 'Seyahat' }).click();
  await prompt.getByRole('button', { name: '2 konuyu kaydet' }).click();
  await expect(page.getByText('İlgi alanların kaydedildi', { exact: true })).toBeVisible();
  await expect(prompt).toBeHidden();
  await page.reload();
  await expect(page.getByTestId('start-study')).toBeVisible();
  await expect(page.getByRole('region', { name: PROMPT })).toBeHidden();
  await expect
    .poll(() => backend.rows.get('settings:settings')?.row.interests, { timeout: 15_000 })
    .toEqual(['technology', 'travel']);

  // Ayarlar → Kartlar ve içerik → İlgi alanların (also Profil → İlgi alanların → Düzenle).
  await addTechTexts(page);
  await page.goto('/settings/kartlar');
  const section = page.getByRole('region', { name: 'Profil' });
  await expect(section.getByText('Teknoloji, Seyahat')).toBeVisible();
  await section.getByRole('link', { name: 'Profili aç' }).click();
  await expect(page).toHaveURL(/\/settings\/ilgi-alanlari$/);
  const weights = page.getByRole('region', { name: 'Profilin' });
  await expect(weights.getByRole('progressbar')).toHaveCount(2);
  await expect(weights.getByRole('progressbar').first()).toHaveAccessibleName('Teknoloji');
  await expect(weights.getByText('Sen seçtin · 3 metin yükledin')).toBeVisible();

  await weights.getByRole('button', { name: 'Seyahat konusunu kapat' }).click();
  const muted = page.getByRole('region', { name: 'Kapalı konular' });
  await expect(muted.getByText('Seyahat')).toBeVisible();
  await expect(weights.getByRole('progressbar')).toHaveCount(1);
  await page.reload();
  await expect(
    page.getByRole('region', { name: 'Kapalı konular' }).getByText('Seyahat'),
  ).toBeVisible();
  await expect
    .poll(() => backend.rows.get('settings:settings')?.row.muted_topics, { timeout: 15_000 })
    .toEqual(['travel']);

  // A second device signed in to the same account: no question, same picks.
  const other = await browser.newContext();
  await backend.install(other);
  await FakeBackend.signIn(other);
  const page2 = await other.newPage();
  await page2.goto('/');
  await expect(page2.getByTestId('start-study')).toBeVisible({ timeout: 20_000 });
  // The old address still works.
  await page2.goto('/settings/profile');
  await expect(page2).toHaveURL(/\/settings\/ilgi-alanlari$/);
  await expect(
    page2
      .getByRole('region', { name: 'İlgi alanların' })
      .getByRole('button', { name: 'Teknoloji' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page2.goto('/');
  await expect(page2.getByTestId('start-study')).toBeVisible();
  await expect(page2.getByRole('region', { name: PROMPT })).toBeHidden();
  await other.close();
});

test('interests: "Şimdi değil" answers the question for good (guest)', async ({ page }) => {
  await addWord(page, WORDS[1]!);
  await page.goto('/');
  await page
    .getByRole('region', { name: PROMPT })
    .getByRole('button', { name: 'Şimdi değil' })
    .click();
  await expect(page.getByRole('region', { name: PROMPT })).toBeHidden();
  await page.reload();
  await expect(page.getByTestId('start-study')).toBeVisible();
  await expect(page.getByRole('region', { name: PROMPT })).toBeHidden();
  await page.goto('/settings/kartlar');
  await expect(
    page.getByRole('region', { name: 'Profil' }).getByText('Henüz bir konu yok.'),
  ).toBeVisible();
});
