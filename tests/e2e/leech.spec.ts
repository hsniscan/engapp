// v0.3 İP6 leeches (docs/decisions/0026-leeches-confusables.md), plan acceptance criterion 5:
// a card forgotten for the 6th time is flagged in that session with at least three paths, and
// nothing is suspended unless the user asks. Phone width (360 px), no horizontal scroll.
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { buildBackup } from '../../src/domain/backup.ts';
import { applyRating, createScheduler, emptyFsrs } from '../../src/domain/fsrs.ts';
import { encodeHlc } from '../../src/domain/hlc.ts';
import type { Card, Note, RatingValue, ReviewLog, Sense } from '../../src/domain/types.ts';
import { dumpTables, expect, test } from './support/app.ts';
import { buildSeedBackup } from './support/seed.ts';

const DAY = 86_400_000;
const HOUR = 3_600_000;

/**
 * "bank" (two senses) whose recognition card has 5 lapses and is due now, and "light" (all
 * cards suspended). The session holds just that one card, so the flag shows on the summary;
 * src/features/leech/leech.test.tsx covers the flag above the next card.
 */
async function leechBackup(now: number) {
  const scheduler = createScheduler({ request_retention: 0.9, fsrs_params: null });
  const ratings: RatingValue[] = [4, 1, 4, 1, 4, 1, 4, 1, 4, 1, 4];
  // Replay once to learn when the last answer falls due, then shift the history so that
  // it is due an hour ago (FSRS only looks at the gaps).
  const replay = (start: number) => {
    let f = emptyFsrs(start);
    let t = start;
    const at: number[] = [];
    for (const r of ratings) {
      t = Math.max(t + 60_000, f.due);
      at.push(t);
      f = applyRating(scheduler, { id: 'c-bank-r', ...f }, r, t);
    }
    return { f, at };
  };
  const shift = now - HOUR - replay(0).f.due;
  const created = shift - DAY;
  const { f, at } = replay(created);
  const hlc = (t: number) => encodeHlc({ ms: t, counter: 0, node: 'seed' });
  const base = (id: string, t = created) => ({ id, user_id: null, created_at: t, updated_at: t, deleted_at: null, hlc: hlc(t) });

  const notes: Note[] = [
    { ...base('n-bank'), term: 'bank', term_norm: 'bank', term_type: 'word', lexicon_term_id: null, ipa: null, tags: [], possible_duplicate: false, level_override: null },
    { ...base('n-light'), term: 'light', term_norm: 'light', term_type: 'word', lexicon_term_id: null, ipa: null, tags: [], possible_duplicate: false, level_override: null },
  ];
  const sense = (id: string, note: string, no: number, tr: string, sentence: string, word: string): Sense => {
    const i = sentence.indexOf(word);
    return {
      ...base(id),
      note_id: note,
      sense_no: no,
      lexicon_sense_id: null,
      pos: 'noun',
      gloss_en: null,
      meaning_tr: tr,
      meaning_tr_override: null,
      source_sentence: sentence,
      source_sentence_tr: null,
      span: [i, i + word.length],
      source_id: null,
    };
  };
  const senses = [
    sense('s-bank-1', 'n-bank', 1, 'banka', 'I went to the bank.', 'bank'),
    sense('s-bank-2', 'n-bank', 2, 'kıyı', 'We sat on the river bank.', 'bank'),
    sense('s-light-1', 'n-light', 1, 'ışık', 'Turn on the light.', 'light'),
  ];
  const last = at[at.length - 1]!;
  const card = (id: string, note: string, type: Card['card_type'], senseId: string | null, extra: Partial<Card>): Card => ({
    ...base(id),
    note_id: note,
    sense_id: senseId,
    card_type: type,
    suspended: false,
    unlocked: type === 'recognition',
    ...emptyFsrs(created),
    ...extra,
  });
  const cards: Card[] = [
    card('c-bank-r', 'n-bank', 'recognition', null, { ...f, updated_at: last, hlc: hlc(last) }),
    card('c-bank-p', 'n-bank', 'production', 's-bank-1', { suspended: true, unlocked: true }),
    card('c-bank-c', 'n-bank', 'cloze', 's-bank-1', { suspended: true, unlocked: true }),
    card('c-light-r', 'n-light', 'recognition', null, { suspended: true }),
    card('c-light-p', 'n-light', 'production', 's-light-1', { suspended: true }),
    card('c-light-c', 'n-light', 'cloze', 's-light-1', { suspended: true }),
  ];
  const logs: ReviewLog[] = ratings.map((rating, i) => ({
    id: `log-${String(i).padStart(3, '0')}`,
    user_id: null,
    card_id: 'c-bank-r',
    rating,
    reviewed_at: at[i]!,
    duration_ms: 4000,
    device_id: 'seed',
    undo_of: null,
    shown_sense_id: 's-bank-1',
    created_at: at[i]!,
    hlc: hlc(at[i]!),
  }));
  const settings = { ...(await buildSeedBackup(3, now)).tables.settings[0]!, daily_new_limit: 10 };
  return buildBackup(
    { notes, senses, cards, review_logs: logs, sources: [], settings: [settings] },
    { exported_at: now, device_id: 'seed' },
  );
}

async function restoreFile(page: Page, file: unknown) {
  const buffer = Buffer.from(JSON.stringify(file));
  await page.goto('/settings#veri');
  await expect(page.getByText('Henüz yedek alınmadı')).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Geri yükle' }).click();
  await (await chooser).setFiles({ name: 'leech.json', mimeType: 'application/json', buffer });
  await page.getByRole('dialog', { name: 'Yedeği geri yükle' }).getByRole('button', { name: 'Üzerine yaz' }).click();
  await expect(page.getByText('Geri yükleme tamamlandı', { exact: true })).toBeVisible({ timeout: 60_000 });
}

/** axe (WCAG 2.2 AA) in light and dark; SHOTS=<dir> also saves screenshots for a visual check. */
async function axe(page: Page, name: string) {
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.waitForTimeout(300);
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(
      violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
      `${name} ${colorScheme}`,
    ).toEqual([]);
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/leech-${name}-${colorScheme}.png` });
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test.use({ viewport: { width: 360, height: 740 } });

test('the 6th lapse is flagged in the session with at least 3 paths; only the user suspends', async ({ page, backend }) => {
  await page.goto('/');
  await restoreFile(page, await leechBackup(Date.now()));

  await page.goto('/review');
  // Forget "bank" for the 6th time.
  await page.getByRole('button', { name: 'Cevabı göster', disabled: false }).click();
  await expect(page.locator('[data-card-type]')).toContainText('bank');
  await expect(page.getByRole('group', { name: 'Ne kadar iyi hatırladın?' })).toBeVisible();
  await page.locator('body').press('1');

  const flag = page.getByTestId('leech-flag');
  await expect(flag).toContainText('“bank” kartını 6. kez unuttun.');
  expect(await noHorizontalScroll(page)).toBe(true);
  await axe(page, 'flag');
  const before = await dumpTables(page, ['cards', 'review_logs']);
  expect(before.cards!.every((c) => (c as Card).id !== 'c-bank-r' || !(c as Card).suspended)).toBe(true);

  await flag.getByRole('button', { name: 'Başka yoldan bakalım' }).click();
  const sheet = page.getByRole('dialog', { name: 'Bu karta başka yoldan bakalım' });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('“bank” kartını 6 kez unuttun.');
  await expect(sheet.locator('[data-path]').first()).toBeVisible();
  expect(await sheet.locator('[data-path]').count()).toBeGreaterThanOrEqual(3);
  await expect(sheet.getByRole('button', { name: /Bir anımsatıcı bul/ })).toBeVisible();
  await expect(sheet.getByRole('button', { name: /Başka bir kelimeyle mi karıştırıyorsun/ })).toBeVisible();
  await expect(sheet.getByRole('button', { name: /Anlamları ayrı kartlara böl/ })).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);

  // Opening the sheet changed nothing.
  expect(await dumpTables(page, ['cards', 'review_logs'])).toEqual(before);

  // The user suspends it, then takes it back.
  await sheet.getByRole('button', { name: /Ara ver ya da baştan başla/ }).click();
  await axe(page, 'sheet');
  await sheet.getByRole('button', { name: 'Askıya al', exact: true }).click();
  await expect(page.getByText('Kart askıya alındı', { exact: true })).toBeVisible();
  await expect.poll(async () => ((await dumpTables(page, ['cards'])).cards as Card[]).find((c) => c.id === 'c-bank-r')!.suspended).toBe(true);
  await page.getByRole('button', { name: 'Geri al' }).last().click();
  await expect.poll(async () => ((await dumpTables(page, ['cards'])).cards as Card[]).find((c) => c.id === 'c-bank-r')!.suspended).toBe(false);
  // No review log was changed.
  expect((await dumpTables(page, ['review_logs'])).review_logs).toEqual(before.review_logs);

  // Stats, "Zorlandıklarım".
  await page.goto('/stats');
  const stats = page.getByTestId('leech-stats');
  await expect(stats.getByRole('heading', { name: 'Zorlandıklarım' })).toBeVisible();
  await expect(stats.getByRole('button', { name: /bank/ })).toContainText('6 kez unuttun');
  await expect(stats.getByRole('link', { name: 'Bunları çalış' })).toHaveAttribute('href', /source=list/);
  expect(await noHorizontalScroll(page)).toBe(true);
  await stats.scrollIntoViewIfNeeded();
  await axe(page, 'stats');

  // A guest never talks to the backend.
  expect(backend.calls).toEqual([]);
});
