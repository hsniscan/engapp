import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { addWord, dumpTables, expect, test } from './support/app.ts';
import { FakeBackend } from './support/backend.ts';

// v0.2 İP3: the level test (offered once on the home screen, redoable from Settings), its
// result, the vocabulary counter and the known words. Guests take it offline.

interface BankWord {
  w: string;
  tr: string;
}
const bank = JSON.parse(readFileSync('data/level-test/bank.json', 'utf8')) as {
  levels: Record<string, BankWord[]>;
};
const levelOf = new Map<string, string>();
const meaningOf = new Map<string, string>();
for (const [level, words] of Object.entries(bank.levels)) {
  for (const w of words) {
    levelOf.set(w.w, level);
    meaningOf.set(w.w, w.tr);
  }
}

/**
 * Answers the test as a user who knows every word up to `knows` and none above, never says
 * yes to a made-up word and picks the right meaning ('always-yes': yes to everything).
 */
async function takeTest(page: Page, knows: string[] | 'always-yes'): Promise<number> {
  const result = page.getByTestId('level-result');
  let n = 0;
  for (; n < 90; n++) {
    const question = page.getByTestId('level-question');
    await expect(question.or(result)).toBeVisible();
    if (await result.isVisible()) break;
    const word = (await page.getByTestId('level-word').textContent())!.trim();
    const step = await question.getAttribute('data-step');
    if ((await question.getAttribute('data-kind')) === 'word') {
      const level = levelOf.get(word);
      const yes = knows === 'always-yes' || (level !== undefined && knows.includes(level));
      // Keyboard: 2 = Biliyorum, 1 = Bilmiyorum.
      await page.locator('body').press(yes ? '2' : '1');
    } else {
      await page
        .getByRole('group', { name: `“${word}” kelimesinin anlamı` })
        .getByRole('button', { name: meaningOf.get(word)!, exact: true })
        .click();
    }
    await expect(page.locator(`[data-testid="level-question"][data-step="${step}"]`)).toHaveCount(0);
  }
  await expect(result).toBeVisible();
  return n;
}

test('guest, offline: the offered level test sets the level, the counter and the known words', async ({
  page,
  context,
}) => {
  test.setTimeout(150_000);
  const requests: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith('http://localhost')) requests.push(r.url());
  });

  await page.goto('/');
  const offer = page.getByTestId('level-offer');
  await expect(offer).toBeVisible();
  await offer.getByRole('link', { name: 'Teste başla' }).click();
  await expect(page).toHaveURL(/\/level-test$/);
  const start = page.getByRole('button', { name: 'Teste başla', disabled: false });
  await expect(start).toBeVisible();

  // Airplane mode from here on: the bank is already part of the screen.
  await context.setOffline(true);
  await start.click();
  const answered = await takeTest(page, ['A1', 'A2', 'B1', 'B2']);
  expect(answered).toBeLessThanOrEqual(70);

  const result = page.getByTestId('level-result');
  await expect(result).toHaveAttribute('data-reliable', 'true');
  await expect(page.getByTestId('result-level')).toHaveText('B2');
  await expect(result.getByText('Seviyen B1 → B2 oldu.')).toBeVisible();
  await expect(page.getByTestId('result-vocab')).toHaveText(/^~\d/);
  await expect(page.getByTestId('result-unreliable')).toHaveCount(0);

  const tables = await dumpTables(page, ['level_tests', 'known_terms', 'settings']);
  expect(tables.level_tests).toHaveLength(1);
  expect(tables.level_tests![0]).toMatchObject({ result_level: 'B2', reliable: true, applied: true, user_id: null });
  expect(tables.settings![0]).toMatchObject({ level: 'B2', level_source: 'test' });
  const known = tables.known_terms as { term_norm: string; source: string; cefr_at_mark: string }[];
  expect(known.length).toBeGreaterThan(0);
  for (const k of known) {
    expect(k.source).toBe('test');
    expect(k.cefr_at_mark).toBe(levelOf.get(k.term_norm));
    expect(['A1', 'A2', 'B1', 'B2']).toContain(k.cefr_at_mark);
  }

  // Home: the offer is gone.
  await page.getByRole('link', { name: 'Ana sayfaya dön' }).click();
  await expect(page.getByRole('heading', { name: 'Hoş geldin', level: 1 })).toBeVisible();
  await expect(page.getByTestId('level-offer')).toHaveCount(0);
  // Back online for the rest (other screens' lazy chunks; no service worker in this test).
  await context.setOffline(false);
  await addWord(page, { term: 'cope', meaning: 'başa çıkmak' });
  await page.goto('/');
  // The Bugün goals card shows the measured level, the next one as the target, and no longer
  // offers to measure it. (The vocabulary counter, VocabTile, left the home screen in the
  // redesign; it keeps its unit tests until İlerleme hosts it.)
  const goals = page.getByTestId('home-goals');
  await expect(goals).toContainText('Seviye tahmini: B2');
  await expect(goals).toContainText('Hedef C1');
  await expect(goals.getByRole('link', { name: /Seviyeni ölç/ })).toHaveCount(0);

  // Settings → Seviye: where the level came from, and the known words (remove one).
  await page.goto('/settings#seviye');
  await expect(page.getByTestId('level-source')).toContainText('Seviye testinden');
  await page.getByRole('link', { name: 'Listeyi aç' }).click();
  const list = page.getByTestId('known-words');
  await expect(list.getByRole('listitem')).toHaveCount(new Set(known.map((k) => k.term_norm)).size);
  const first = [...new Set(known.map((k) => k.term_norm))].sort((a, b) => a.localeCompare(b, 'en'))[0]!;
  await page.getByRole('button', { name: `“${first}” kelimesini listeden çıkar` }).click();
  await expect(list.getByText(first, { exact: true })).toHaveCount(0);

  expect(requests).toEqual([]);
});

test('guessing makes the result unreliable: nothing changes until "Sonucu yine de kullan"', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto('/settings#seviye');
  await page.getByRole('link', { name: 'Testi çöz' }).click();
  await page.getByRole('button', { name: 'Teste başla', disabled: false }).click();
  await takeTest(page, 'always-yes');

  const warning = page.getByTestId('result-unreliable');
  await expect(warning).toBeVisible();
  await expect(warning).toContainText('Uydurma kelimelerin');
  await expect(warning).toContainText('Seviyen değişmedi (B1)');
  let tables = await dumpTables(page, ['level_tests', 'known_terms', 'settings']);
  expect(tables.level_tests![0]).toMatchObject({ reliable: false, applied: false });
  expect(tables.known_terms).toHaveLength(0);
  expect((tables.settings![0] as { level?: string } | undefined)?.level ?? 'B1').toBe('B1');

  const level = (await page.getByTestId('result-level').textContent())!.trim();
  await warning.getByRole('button', { name: 'Sonucu yine de kullan' }).click();
  await expect(page.getByText(`Seviyen ${level} oldu.`).first()).toBeVisible();
  tables = await dumpTables(page, ['settings']);
  expect(tables.settings![0]).toMatchObject({ level, level_source: 'test' });
});

test('signed in: the test and the known words sync to the account', async ({ page, context, backend }) => {
  test.setTimeout(150_000);
  await FakeBackend.signIn(context);
  await page.goto('/level-test');
  await page.getByRole('button', { name: 'Teste başla', disabled: false }).click();
  await takeTest(page, ['A1', 'A2', 'B1']);
  await expect(page.getByTestId('result-level')).toHaveText('B1');
  await expect.poll(() => backend.pushedIds('level_tests').length, { timeout: 20_000 }).toBe(1);
  await expect.poll(() => backend.pushedIds('known_terms').length, { timeout: 20_000 }).toBeGreaterThan(0);
});
