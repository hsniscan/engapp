// v0.3 İP3 load management (docs/decisions/0021-load-management.md):
//   - after a 5-day break the home screen shows catch-up and today's queue holds at most the
//     daily capacity, with no new cards, and catch-up writes nothing by itself;
//   - vacation: no new cards, the streak stays frozen, new cards ramp 0 → ½ → full on return.
import type { Page } from '@playwright/test';
import { buildBackup } from '../../src/domain/backup.ts';
import { addWord, dumpTables, expect, test, type Word } from './support/app.ts';
import { buildSeedBackup } from './support/seed.ts';

const DAY = 86_400_000;

async function restoreFile(page: Page, file: unknown) {
  const buffer = Buffer.from(JSON.stringify(file));
  await page.goto('/settings#veri');
  await expect(page.getByText('Henüz yedek alınmadı')).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Geri yükle' }).click();
  await (await chooser).setFiles({ name: 'gap.json', mimeType: 'application/json', buffer });
  await page
    .getByRole('dialog', { name: 'Yedeği geri yükle' })
    .getByRole('button', { name: 'Üzerine yaz' })
    .click();
  await expect(page.getByText('Geri yükleme tamamlandı', { exact: true })).toBeVisible({
    timeout: 120_000,
  });
}

function todayCount(page: Page, label: 'Vadesi gelen' | 'Yeni') {
  return page
    .getByRole('region', { name: 'Bugünün tekrarı' })
    .locator('dt', { hasText: label })
    .locator('xpath=following-sibling::dd');
}

test('5-day break: catch-up caps today at the daily capacity and pauses new cards', async ({
  page,
}) => {
  test.setTimeout(180_000);
  // A long-time user whose last review was 5 days ago; 5 minutes a day.
  const seed = await buildSeedBackup(900, Date.now() - 5 * DAY);
  const settings = { ...seed.tables.settings[0]!, daily_capacity_min: 5, daily_new_limit: 10 };
  const file = await buildBackup(
    { ...seed.tables, settings: [settings] },
    { exported_at: Date.now(), device_id: 'seed' },
  );
  await page.goto('/');
  await restoreFile(page, file);

  await page.goto('/');
  const note = page.getByTestId('load-catchup');
  await expect(note).toBeVisible();
  await expect(note.getByRole('heading')).toHaveText(/Telafi/);
  const body = (await note.textContent()) ?? '';
  const cap = Number(/bugün en çok (\d+) kart/.exec(body)?.[1]);
  const backlog = Number(/Biriken (\d+) tekrarı/.exec(body)?.[1]);
  expect(cap).toBeGreaterThan(0);
  expect(backlog).toBeGreaterThan(cap);
  await expect(todayCount(page, 'Yeni')).toHaveText('0');
  const due = Number(await todayCount(page, 'Vadesi gelen').textContent());
  expect(due).toBeLessThanOrEqual(cap + 5); // + learning steps, never capped
  expect(due).toBeGreaterThan(0);

  // Building and opening the capped queue writes nothing; each answer writes one review log.
  const before = await dumpTables(page, ['cards', 'review_logs']);
  await page.getByRole('link', { name: 'Tekrara başla' }).click();
  await expect(page.getByRole('button', { name: 'Cevabı göster', disabled: false })).toBeVisible();
  expect(await dumpTables(page, ['cards', 'review_logs'])).toEqual(before);
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: 'Cevabı göster', disabled: false }).click();
    await expect(page.getByRole('group', { name: 'Ne kadar iyi hatırladın?' })).toBeVisible();
    await page.locator('body').press('3');
  }
  await expect
    .poll(async () => (await dumpTables(page, ['review_logs'])).review_logs!.length)
    .toBe(before.review_logs!.length + 3);
});

const VOCAB: Word[] = [
  { term: 'scarce', meaning: 'kıt' },
  { term: 'curb', meaning: 'dizginlemek' },
  { term: 'feasible', meaning: 'uygulanabilir' },
  { term: 'hinder', meaning: 'engellemek' },
  { term: 'tackle', meaning: 'ele almak' },
  { term: 'thrive', meaning: 'gelişmek' },
  { term: 'cope', meaning: 'başa çıkmak' },
];

test('vacation: no new cards, streak frozen, new cards ramp back 0 → ½ → full', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const at = (day: string) => new Date(`${day}T12:00:00+03:00`);
  await page.clock.install({ time: at('2026-11-02') });
  await page.goto('/');

  // Day 1: one word studied (streak 1), six more waiting.
  await addWord(page, VOCAB[0]!);
  await page.goto('/review');
  await page.getByRole('button', { name: 'Cevabı göster', disabled: false }).click();
  await page.locator('body').press('4');
  await expect(page.getByRole('heading', { name: 'Oturum tamamlandı' })).toBeVisible();
  for (const w of VOCAB.slice(1)) await addWord(page, w);

  // Vacation 3–5 November.
  await page.goto('/settings#yuk');
  await page.getByLabel('Başlangıç', { exact: true }).fill('2026-11-03');
  await page.getByLabel('Bitiş', { exact: true }).fill('2026-11-05');
  await page.getByRole('button', { name: 'Tatili kaydet' }).click();
  await expect(page.getByText('Tatil kaydedildi', { exact: true })).toBeVisible();
  await expect(page.getByTestId('vacation-current')).toContainText('3 Kasım');

  const streak = () => page.getByRole('region', { name: 'Günlük seri' }).locator('.text-6xl');

  // On vacation: no new cards, the streak is kept.
  await page.clock.setSystemTime(at('2026-11-04'));
  await page.goto('/');
  await expect(page.getByTestId('load-vacation')).toContainText('Tatildesin');
  await expect(page.getByText('Bugünlük bitti')).toBeVisible();
  await expect(streak()).toHaveText('1');

  // First day back: still no new cards, streak still 1.
  await page.clock.setSystemTime(at('2026-11-06'));
  await page.goto('/');
  await expect(page.getByTestId('load-ramp')).toContainText('Tekrar hoş geldin');
  await expect(page.getByText('Bugünlük bitti')).toBeVisible();
  await expect(streak()).toHaveText('1');

  // Second day back: half the limit (5 of 10).
  await page.clock.setSystemTime(at('2026-11-07'));
  await page.goto('/');
  await expect(page.getByTestId('load-ramp')).toContainText('bugün 5 yeni kart');
  await expect(todayCount(page, 'Yeni')).toHaveText('5');

  // Then the full limit (all six waiting).
  await page.clock.setSystemTime(at('2026-11-08'));
  await page.goto('/');
  await expect(todayCount(page, 'Yeni')).toHaveText('7'); // six words + the first word's production card
  await expect(page.getByTestId('load-ramp')).toHaveCount(0);
});

test('stats: 30-day forecast with the capacity line and a text summary', async ({ page }) => {
  await page.goto('/');
  await addWord(page, VOCAB[0]!);
  await page.goto('/stats');
  const section = page.getByRole('region', { name: 'Önümüzdeki 30 gün' });
  await expect(section.getByRole('img', { name: /beklenen tekrar sayısı/ })).toBeVisible();
  await expect(section.getByText(/günde ortalama \d+ tekrar bekleniyor/)).toBeVisible();
  await expect(section.getByText(/Kapasite: günde \d+ kart/)).toBeVisible();
  await section.getByText('Günlere göre liste').click();
  await expect(section.getByRole('row')).toHaveCount(31);
});
