// v0.3 İP3 load management (docs/decisions/0021-load-management.md):
//   - after a 5-day break the home screen shows catch-up and today's queue holds at most the
//     daily capacity, with no new cards, and catch-up writes nothing by itself;
//   - vacation: no new cards, the streak stays frozen, new cards ramp 0 → ½ → full on return.
import type { Page } from '@playwright/test';
import { buildBackup } from '../../src/domain/backup.ts';
import type { Card, Note } from '../../src/domain/types.ts';
import { addWord, dumpTables, expect, test, type Word } from './support/app.ts';
import { buildSeedBackup } from './support/seed.ts';

const DAY = 86_400_000;

async function restoreFile(page: Page, file: unknown) {
  const buffer = Buffer.from(JSON.stringify(file));
  await page.goto('/settings/veri');
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

/** The hero's word-study split, "N tekrar · M yeni · yaklaşık K dk", as numbers. */
async function todaySplit(page: Page): Promise<{ due: number; fresh: number }> {
  const split = page.getByTestId('today-split');
  await expect(split).toBeVisible();
  const m = /(\d+) tekrar · (\d+) yeni/.exec((await split.textContent()) ?? '');
  return { due: Number(m?.[1]), fresh: Number(m?.[2]) };
}

/** Cards waiting today summed over the "Çalışma türleri" tiles (a finished tile counts 0). */
async function studyTypesTotal(page: Page): Promise<number> {
  let total = 0;
  for (const mode of ['word', 'production', 'cloze']) {
    const text = (await page.getByTestId(`study-type-${mode}`).textContent()) ?? '';
    total += Number(/(\d+)\s*(kart|cümle)/.exec(text)?.[1] ?? 0);
  }
  return total;
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
  const { due, fresh } = await todaySplit(page);
  expect(fresh).toBe(0);
  expect(due).toBeLessThanOrEqual(cap + 5); // + learning steps, never capped
  expect(due).toBeGreaterThan(0);

  // Building and opening the capped queue writes nothing; each answer writes one review log.
  const before = await dumpTables(page, ['cards', 'review_logs']);
  await page.getByTestId('start-study').click();
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
  await page.goto('/settings/yuk');
  await page.getByLabel('Başlangıç', { exact: true }).fill('2026-11-03');
  await page.getByLabel('Bitiş', { exact: true }).fill('2026-11-05');
  await page.getByRole('button', { name: 'Tatili kaydet' }).click();
  await expect(page.getByText('Tatil kaydedildi', { exact: true })).toBeVisible();
  await expect(page.getByTestId('vacation-current')).toContainText('3 Kasım');

  const streak = () => page.getByTestId('today-streak');

  // On vacation: no new cards, the streak is kept.
  await page.clock.setSystemTime(at('2026-11-04'));
  await page.goto('/');
  await expect(page.getByTestId('load-vacation')).toContainText('Tatildesin');
  await expect(page.getByTestId('today-hero-done')).toBeVisible();
  await expect(streak()).toContainText('1 günlük seri');

  // First day back: still no new cards, streak still 1. The first word ("Kolay" on day 1) is
  // due: a new word's Easy goes at most 3 days out (learning model, decision 0041).
  await page.clock.setSystemTime(at('2026-11-06'));
  await page.goto('/');
  await expect(page.getByTestId('load-ramp')).toContainText('Tekrar hoş geldin');
  await expect.poll(() => todaySplit(page)).toEqual({ due: 1, fresh: 0 });
  await expect(streak()).toContainText('1 günlük seri');

  // Second day back: half the limit (5 of 10).
  await page.clock.setSystemTime(at('2026-11-07'));
  await page.goto('/');
  await expect(page.getByTestId('load-ramp')).toContainText('bugün 5 yeni kart');
  // The first word is still due; its production card stays locked (Pekişiyor, decision 0041).
  await expect.poll(() => todaySplit(page)).toEqual({ due: 1, fresh: 5 });

  // Then the full limit: the six waiting words. The first word's recognition card (due since
  // the 5th) is a review today; its production card stays locked until the word is recalled
  // on another day (Pekişiyor, decision 0041).
  await page.clock.setSystemTime(at('2026-11-08'));
  await page.goto('/');
  const { cards, notes } = await dumpTables(page, ['cards', 'notes']);
  const first = (notes as Note[]).find((n) => n.term === VOCAB[0]!.term)!;
  const recognition = (cards as Card[]).find((c) => c.note_id === first.id && c.card_type === 'recognition')!;
  const recognitionDueToday = recognition.due < at('2026-11-09').getTime();
  expect(recognitionDueToday).toBe(true);
  await expect.poll(() => todaySplit(page)).toEqual({ due: 1, fresh: 6 });
  // Nothing in the other study types yet: production waits for Pekişiyor, cloze too.
  await expect.poll(() => studyTypesTotal(page)).toBe(7);
  await expect(page.getByTestId('load-ramp')).toHaveCount(0);
});

test('stats: 30-day forecast with the capacity line and a text summary', async ({ page }) => {
  await page.goto('/');
  await addWord(page, VOCAB[0]!);
  await page.goto('/progress');
  const section = page.getByRole('region', { name: 'Önümüzdeki 30 gün' });
  await expect(section.getByRole('img', { name: /beklenen tekrar sayısı/ })).toBeVisible();
  await expect(section.getByText(/günde ortalama \d+ tekrar bekleniyor/)).toBeVisible();
  await expect(section.getByText(/Kapasite: günde \d+ kart/)).toBeVisible();
  await section.getByText('Günlere göre liste').click();
  await expect(section.getByRole('row')).toHaveCount(31);
});
