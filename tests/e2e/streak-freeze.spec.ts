// v0.5 İP10 streak protection (docs/decisions/0052-smart-review.md): after a missed day, Bugün
// covers it automatically, the streak goes on and a calm note says so once.
import { buildBackup } from '../../src/domain/backup.ts';
import type { ReviewLog } from '../../src/domain/types.ts';
import { dumpTables, expect, test } from './support/app.ts';
import { buildSeedBackup } from './support/seed.ts';

const H = 3_600_000;
const DAY = 24 * H;

/** Start of the Istanbul study day (UTC+3, day starts 04:00) `k` days before today's. */
function dayStart(now: number, k: number): number {
  return Math.floor((now - H) / DAY) * DAY + H - k * DAY;
}

test('a missed day is covered: the streak goes on and Bugün shows a calm note once', async ({ page }) => {
  test.setTimeout(180_000);
  const now = Date.now();
  const seed = await buildSeedBackup(30, now);
  // Nothing yesterday or today; one review a day on the eight days before.
  const before = seed.tables.review_logs.filter((l) => l.reviewed_at < dayStart(now, 1));
  const card = seed.tables.cards.find((c) => c.card_type === 'recognition')!;
  const daily: ReviewLog[] = Array.from({ length: 8 }, (_, i) => {
    const t = dayStart(now, i + 2) + 8 * H;
    return {
      id: `log-e2e-${i}`,
      user_id: null,
      card_id: card.id,
      rating: 3,
      reviewed_at: t,
      duration_ms: 4000,
      device_id: 'seed',
      undo_of: null,
      shown_sense_id: null,
      created_at: t,
      hlc: `${String(t).padStart(15, '0')}:00000:seed`,
    };
  });
  const file = await buildBackup(
    { ...seed.tables, review_logs: [...before, ...daily].sort((a, b) => a.reviewed_at - b.reviewed_at) },
    { exported_at: now, device_id: 'seed' },
  );

  await page.goto('/settings/veri');
  await expect(page.getByText('Henüz yedek alınmadı')).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Geri yükle' }).click();
  await (await chooser).setFiles({ name: 'gap.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
  await page.getByRole('dialog', { name: 'Yedeği geri yükle' }).getByRole('button', { name: 'Üzerine yaz' }).click();
  await expect(page.getByText('Geri yükleme tamamlandı', { exact: true })).toBeVisible({ timeout: 120_000 });

  await page.goto('/');
  const note = page.getByTestId('streak-freeze-note');
  await expect(note).toBeVisible({ timeout: 20_000 });
  await expect(note.getByRole('heading')).toHaveText('Serin korundu');
  await expect(note).toContainText('Dün tekrar yapılmadı.');
  await expect(note).toContainText('Bu ay 1 koruma daha var.');
  // The streak goes on: at least the eight days before the missed one.
  const streak = Number(/(\d+) günlük seri/.exec((await page.getByTestId('today-streak').textContent()) ?? '')?.[1]);
  expect(streak).toBeGreaterThanOrEqual(8);

  // The protection is one synced settings field (the outbox carries it for an account).
  const { settings } = (await dumpTables(page, ['settings'])) as { settings: { streak_freezes?: string[] }[] };
  expect(settings[0]!.streak_freezes).toHaveLength(1);

  // Closed, it stays closed; reopening does not spend another protection.
  await note.getByRole('button', { name: 'Kapat' }).click();
  await expect(note).toBeHidden();
  await page.reload();
  await expect(page.getByTestId('today-streak')).toBeVisible();
  await expect(page.getByTestId('streak-freeze-note')).toBeHidden();
  const again = (await dumpTables(page, ['settings'])) as { settings: { streak_freezes?: string[] }[] };
  expect(again.settings[0]!.streak_freezes).toHaveLength(1);
});
