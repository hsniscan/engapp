// Smart extraction (v0.2 İP4, plan criterion 5, decision 0018): the preview's three sections,
// pre-selection by the learner's level, "Biliyorum", the "Kolay" setting, vocabulary lists,
// and that what the learner knows never leaves the device.
import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import { FAKE_SPECS } from '../../src/features/import/testing/fakeSpecs.ts';
import { expect, test } from './support/app.ts';
import { FakeBackend } from './support/backend.ts';

test.beforeEach(async ({ context }) => {
  await FakeBackend.signIn(context);
});

/** Optional light/dark screenshots for review: SCREENSHOT_DIR=/some/dir pnpm e2e smart-extract. */
// Viewport shots, scrolled to a section: the rows use content-visibility, so a full-page shot
// leaves the rows off screen empty.
async function shots(page: Page, name: string, at?: Locator) {
  const dir = process.env.SCREENSHOT_DIR;
  if (!dir) return;
  if (at) await at.scrollIntoViewIfNeeded();
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(500); // let the colour transitions settle
    await page.screenshot({ path: `${dir}/${name}-${scheme}.png` });
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

async function extract(page: Page, text: string, title: string) {
  await page.goto('/add?tab=paste');
  await expect(page.getByRole('status', { name: 'Senkron durumu: Senkronlandı' })).toBeVisible();
  await page.getByLabel('İngilizce metin').fill(text);
  await page.getByLabel('Başlık').fill(title);
  await page.getByRole('button', { name: 'Kelimeleri çıkar' }).click();
  await page.getByRole('link', { name: 'Önizlemeyi aç' }).first().click();
  await expect(page).toHaveURL(/\/import\//);
}

test('B1 learner: "Senin için" by level, "Kolay" closed, "Biliyorum"; the known list stays on the device', async ({
  page,
  backend,
}) => {
  // 24 corpus words: 6 at B1, 7 at B2, 8 lower, 3 above B2 (levels from the real reference data).
  await extract(
    page,
    FAKE_SPECS.slice(0, 24)
      .map((s) => s.sentence)
      .join(' '),
    'Karışık metin',
  );

  await expect(page.getByTestId('smart-summary')).toHaveText(
    'B1 seviyene göre bu metinde 24 aday: senin için 16, kolay 5, zaten bildiğin 0. Seviyenin bir üstünü aşan 3 aday önerilmedi.',
  );
  // 6 B1 + 1 B2 (10 %) + 3 lower = 10 pre-selected.
  await expect(page.getByText('10/21 seçili').first()).toBeVisible();
  const forYou = page.getByRole('list', { name: 'Senin için' });
  await expect(forYou.getByRole('listitem')).toHaveCount(16);
  const checked = forYou.getByRole('checkbox', { checked: true });
  await expect(checked).toHaveCount(10);
  // Never above B2: the C1/C2 items are not offered at all.
  for (const term of ['cut corners', 'by and large', 'subsidy'])
    await expect(page.getByText(term, { exact: true })).toHaveCount(0);
  // Level badges on the rows.
  await expect(
    forYou.getByRole('listitem').filter({ hasText: 'widespread' }).locator('[data-level="B1"]'),
  ).toBeVisible();

  // "Kolay" is closed until opened; its words are not selected.
  const easyToggle = page.getByRole('button', { name: /^Kolay \d+$/ });
  await expect(easyToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('list', { name: 'Kolay' })).toHaveCount(0);
  await easyToggle.click();
  const easy = page.getByRole('list', { name: 'Kolay' });
  await expect(easy.getByRole('listitem')).toHaveCount(5);
  await expect(easy.getByRole('checkbox', { checked: true })).toHaveCount(0);
  // Accessibility of the new sections, light and dark (the a11y sweep does not open a preview).
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(500);
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(
      violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
      scheme,
    ).toEqual([]);
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await shots(page, 'preview-top', page.getByTestId('smart-summary'));
  await shots(page, 'preview-easy', easyToggle);

  // "Biliyorum": the word moves to "Biliyorsun" and is no longer selected.
  await page.getByRole('button', { name: 'widespread: biliyorum' }).click();
  await expect(page.getByText('“widespread” bildiklerine eklendi').first()).toBeVisible();
  await expect(page.getByText('9/21 seçili').first()).toBeVisible();
  await page.getByRole('button', { name: /^Biliyorsun \d+$/ }).click();
  await expect(
    page
      .getByRole('list', { name: 'Biliyorsun' })
      .getByRole('listitem')
      .filter({ hasText: 'widespread' }),
  ).toBeVisible();

  // Privacy: the AI request carries the text and the level, nothing about known words.
  const bodies = backend.calls.filter((c) => c.name === 'ai-extract').map((c) => c.body);
  expect(bodies).toHaveLength(1);
  expect(Object.keys(bodies[0] as object).sort()).toEqual(['chunk_hash', 'level', 'text']);

  await page.getByRole('button', { name: '9 kelimeyi ekle' }).click();
  await expect(page).toHaveURL(/\/library/);
  const list = page.getByRole('list', { name: 'Notlar' });
  await expect(list.getByRole('listitem')).toHaveCount(9);
  await expect(list.getByText('widespread', { exact: true })).toHaveCount(0);

  // "Biliyorum" made it an İP3 known word: synced to the account, listed under "Bildiğim
  // kelimeler", and a later text does not offer it again.
  await expect
    .poll(() =>
      [...backend.rows.values()]
        .filter((r) => r.table === 'known_terms')
        .map((r) => [r.row.term_norm, r.row.source]),
    )
    .toEqual([['widespread', 'preview']]);
  await page.goto('/settings/bilinen-kelimeler');
  await expect(page.getByText('widespread', { exact: true })).toBeVisible();
  await extract(page, 'There is widespread concern about rising rents.', 'İkinci metin');
  await expect(page.getByTestId('smart-summary')).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Senin için' }).getByText('widespread', { exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: /^Biliyorsun \d+$/ }).click();
  await expect(
    page
      .getByRole('list', { name: 'Biliyorsun' })
      .getByRole('listitem')
      .filter({ hasText: 'widespread' }),
  ).toBeVisible();
});

test('show_easy_candidates: "Kolay" opens by default (synced setting)', async ({
  page,
  backend,
}) => {
  await page.goto('/settings/calisma');
  const toggle = page.getByRole('switch', { name: /Kolay adayları açık göster/ });
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect
    .poll(() => {
      const row = [...backend.rows.values()].find((r) => r.table === 'settings');
      return row?.row.show_easy_candidates;
    })
    .toBe(true);

  await extract(
    page,
    FAKE_SPECS.slice(0, 24)
      .map((s) => s.sentence)
      .join(' '),
    'Kolay açık',
  );
  await expect(page.getByRole('button', { name: /^Kolay \d+$/ })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(page.getByRole('list', { name: 'Kolay' }).getByRole('listitem')).toHaveCount(5);
});

test('vocabulary list: every entry is listed (above-level ones in their own closed section), in list order', async ({
  page,
  backend,
}) => {
  void backend; // installs the mocked Supabase routes
  const specs = FAKE_SPECS.slice(0, 12);
  const text = specs.map((s, i) => `${i + 1} ${s.term} ${s.sentence}`).join('\n');
  await extract(page, text, 'Kelime listesi');

  // Nothing is hidden: the three C1/C2 entries are in "Seviyenin üstünde", not just counted.
  await expect(page.getByTestId('smart-summary')).toHaveText(
    'B1 seviyene göre bu metinde 12 aday: senin için 9, kolay 0, zaten bildiğin 0.',
  );
  await expect(page.getByText('6/12 seçili').first()).toBeVisible();
  const hard = page.getByRole('button', { name: /^Seviyenin üstünde \d+$/ });
  await expect(hard).toHaveAttribute('aria-expanded', 'false');
  await hard.click();
  const above = page.getByRole('list', { name: 'Seviyenin üstünde' });
  await expect(above.getByRole('listitem')).toHaveCount(3);
  await expect(above.getByRole('checkbox', { checked: true })).toHaveCount(0);
  // The list's own order inside "Senin için" (the pre-selected entries come first).
  const terms = await page
    .getByRole('list', { name: 'Senin için' })
    .locator('li span[lang="en"].font-serif')
    .allTextContents();
  expect(terms.slice(0, 6)).toEqual([
    'give up',
    'come up with',
    'put off',
    'bank',
    'be used to doing sth',
    'take advantage of sth',
  ]);
  await shots(page, 'list-top', page.getByTestId('smart-summary'));
  await shots(page, 'list-above', hard);
});
