import { FAKE_SPECS } from '../../src/features/import/testing/fakeSpecs.ts';
import { addWord, dumpTables, expect, test, type Word } from './support/app.ts';
import { FakeBackend } from './support/backend.ts';

// v0.2 İP2 "Kelime seviyesi": badges from the cached level file (guest, no backend), the level
// filter and sort on the Cards screen, the user's own level, the card-back explanation and the
// Kaynaklar page.

const LEVEL_WORDS: Word[] = [
  { term: 'television', meaning: 'televizyon' }, // CEFR-J A1
  { term: 'reluctant', meaning: 'isteksiz' }, // CEFR-J B2
  { term: 'thrive', meaning: 'gelişmek' }, // not in the lists: frequency (Zipf 3.7) → B2
];

test('Cards: level badges, filter and sort by level, and the user’s own level', async ({
  page,
}) => {
  for (const w of LEVEL_WORDS) await addWord(page, w);
  await page.goto('/library');
  const list = page.getByRole('list', { name: 'Notlar' });
  const row = (term: string) => list.getByRole('listitem').filter({ hasText: term });

  // Badges: list level (solid) and frequency level, named with their source.
  await expect(
    row('television').getByRole('img', { name: 'Seviye A1, CEFR-J listesi' }),
  ).toBeVisible();
  await expect(
    row('reluctant').getByRole('img', { name: 'Seviye B2, CEFR-J listesi' }),
  ).toBeVisible();
  await expect(row('thrive').getByRole('img', { name: 'Seviye B2, Sıklık verisi' })).toBeVisible();

  // Filter: B2 only, kept in the URL.
  await page.getByRole('combobox', { name: 'Seviye' }).click();
  await page.getByRole('option', { name: /^B2/ }).click();
  await expect(page).toHaveURL(/[?&]level=B2/);
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(row('television')).toHaveCount(0);

  // Back to all levels; sort hardest first, then easiest first.
  await page.getByRole('combobox', { name: 'Seviye' }).click();
  await page.getByRole('option', { name: 'Tüm seviyeler' }).click();
  await expect(list.getByRole('listitem')).toHaveCount(3);
  await page.getByRole('combobox', { name: 'Sıralama' }).click();
  await page.getByRole('option', { name: 'Seviye: zordan kolaya' }).click();
  const terms = list.locator('[lang="en"]');
  await expect(terms).toHaveText(['reluctant', 'thrive', 'television']);
  await page.getByRole('combobox', { name: 'Sıralama' }).click();
  await page.getByRole('option', { name: 'Seviye: kolaydan zora' }).click();
  await expect(terms).toHaveText(['television', 'reluctant', 'thrive']);

  // The user's own level, from the note's details: applied at once, synced column, only theirs.
  await row('television').getByRole('button').first().click();
  const sheet = page.getByRole('dialog', { name: 'television' });
  const section = sheet.getByTestId('level-section');
  await expect(section.getByTestId('level-explanation')).toContainText('CEFR-J listesi');
  await section.getByRole('combobox', { name: 'Bu kelimenin seviyesi' }).click();
  await page.getByRole('option', { name: /^C1/ }).click();
  await expect(section.getByRole('img', { name: 'Seviye C1, Senin seçimin' })).toBeVisible();
  await expect(section.getByTestId('level-explanation')).toContainText(
    'Otomatik seviye: A1 (CEFR-J listesi).',
  );
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(
    row('television').getByRole('img', { name: 'Seviye C1, Senin seçimin' }),
  ).toBeVisible();

  const { notes } = await dumpTables(page, ['notes']);
  const tv = (notes as { term: string; level_override: string | null }[]).find(
    (n) => n.term === 'television',
  );
  expect(tv?.level_override).toBe('C1');

  // Survives a reload; "Otomatik" clears it.
  await page.reload();
  await expect(
    row('television').getByRole('img', { name: 'Seviye C1, Senin seçimin' }),
  ).toBeVisible();
  await row('television').getByRole('button').first().click();
  await page
    .getByRole('dialog', { name: 'television' })
    .getByRole('combobox', { name: 'Bu kelimenin seviyesi' })
    .click();
  await page.getByRole('option', { name: 'Otomatik (A1)' }).click();
  await page.keyboard.press('Escape');
  await expect(
    row('television').getByRole('img', { name: 'Seviye A1, CEFR-J listesi' }),
  ).toBeVisible();
});

test('card back: the level badge explains itself and links to Kaynaklar; Settings → Hakkında too', async ({
  page,
}) => {
  await addWord(page, LEVEL_WORDS[1]!);
  await page.goto('/review');
  await page.getByRole('button', { name: 'Cevabı göster', disabled: false }).click();
  const badge = page.getByRole('button', { name: 'Seviye B2, CEFR-J listesi. Açıklamayı göster' });
  await expect(badge).toBeVisible();
  await badge.click();
  const dialog = page.getByRole('dialog', { name: /reluctant/ });
  await expect(dialog.getByTestId('level-explanation')).toContainText('CEFR-J kelime listesinde');
  await dialog.getByRole('link', { name: 'Kaynaklar' }).click();

  await expect(page).toHaveURL(/\/settings\/kaynaklar$/);
  await expect(page.getByRole('heading', { name: 'Kaynaklar', level: 1 })).toBeVisible();
  const sources = page.getByRole('list', { name: 'Kaynaklar' });
  await expect(sources.getByRole('heading', { name: 'CEFR-J Wordlist 1.5' })).toBeVisible();
  await expect(
    sources.getByText('Kaynak gösterilerek araştırma ve ticari amaçla ücretsiz kullanılabilir.'),
  ).toBeVisible();
  await expect(
    sources.getByRole('heading', { name: 'Octanove Vocabulary Profile C1/C2 1.0' }),
  ).toBeVisible();
  await expect(sources.getByRole('heading', { name: 'wordfreq 3.1.1' })).toBeVisible();
  await expect(sources.getByText('CC BY-SA 4.0', { exact: true })).toBeVisible();

  // The settings page reaches it through "Hakkında ve yardım".
  await page.locator('a[href="/settings/hakkinda"]').click();
  await expect(page).toHaveURL(/\/settings\/hakkinda$/);
  await page
    .getByRole('link', { name: /Kaynaklar/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'Kaynaklar', level: 1 })).toBeVisible();
});

test('the level file is a separate asset fetched on first need, not part of the app bundle', async ({
  page,
}) => {
  const fetched: string[] = [];
  page.on('request', (r) => {
    if (/\/assets\/client-levels-[^/]+\.tsv$/.test(new URL(r.url()).pathname))
      fetched.push(r.url());
  });
  await page.goto('/add');
  await addWord(page, LEVEL_WORDS[0]!);
  await page.goto('/library');
  await expect(page.getByRole('img', { name: 'Seviye A1, CEFR-J listesi' })).toBeVisible();
  expect(fetched).toHaveLength(1);
});

test('signed in: levels stored with the lexicon by ai-extract; an AI guess has a dashed badge', async ({
  page,
  context,
  backend,
}) => {
  await FakeBackend.signIn(context);
  const specs = FAKE_SPECS.filter((s) => ['reluctant', 'backfire', 'cut corners'].includes(s.term));
  // A B2 learner: the two B2 words are pre-selected, the C1 idiom (one above) is picked by hand.
  await page.goto('/settings/seviye');
  await page.getByRole('combobox', { name: 'Seviyen' }).click();
  await page.getByRole('option', { name: /^B2/ }).click();
  await expect(page.getByRole('combobox', { name: 'Seviyen' })).toContainText('B2');
  await page.goto('/add?tab=paste');
  await expect(page.getByRole('status', { name: 'Senkron durumu: Senkronlandı' })).toBeVisible();
  await page.getByLabel('İngilizce metin').fill(specs.map((s) => s.sentence).join(' '));
  await page.getByRole('button', { name: 'Kelimeleri çıkar' }).click();
  await page.getByRole('link', { name: 'Önizlemeyi aç' }).click();
  expect(backend.model.calls).toBe(1);
  await page.getByRole('checkbox', { name: 'cut corners seç' }).click();
  await page.getByRole('button', { name: '3 kelimeyi ekle' }).click();
  await expect(page).toHaveURL(/\/library/);

  const list = page.getByRole('list', { name: 'Notlar' });
  const row = (term: string) => list.getByRole('listitem').filter({ hasText: term });
  // In the list: the list level wins over the model's guess (B1).
  await expect(
    row('reluctant').getByRole('img', { name: 'Seviye B2, CEFR-J listesi' }),
  ).toBeVisible();
  // Not in the list: the guess, bounded by frequency; dashed.
  const ai = row('backfire').getByRole('img', { name: 'Seviye B2, AI tahmini' });
  await expect(ai).toBeVisible();
  await expect(ai).toHaveCSS('border-top-style', 'dashed');
  await expect(
    row('cut corners').getByRole('img', { name: 'Seviye C1, AI tahmini' }),
  ).toBeVisible();

  // The level came with the lexicon row (shared data), not from the device's level file.
  const { lexicon_cache } = await dumpTables(page, ['lexicon_cache']);
  const backfire = (
    lexicon_cache as { lemma_norm: string; cefr?: string; cefr_source?: string }[]
  ).find((l) => l.lemma_norm === 'backfire');
  expect(backfire).toMatchObject({ cefr: 'B2', cefr_source: 'ai' });
});
