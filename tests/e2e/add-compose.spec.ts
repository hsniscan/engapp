// v0.5.1 "Ekle" (decision 0056) at phone width: the four-group Add sheet with its word lookup,
// "Kelimelerimle metin oluştur" with a mocked ai-story, and the CSV / word list import.
// SHOTS=<dir> also saves screenshots (light, and the sheet in dark).
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { dumpTables, expect, test } from './support/app.ts';
import { FakeBackend, SUPABASE_URL } from './support/backend.ts';
import { serveWordBank, type BankRowSeed } from './support/wordBankSeed.ts';

test.use({ viewport: { width: 390, height: 844 } });

const SHOTS = process.env.SHOTS;

async function shot(page: Page, name: string, dark = false) {
  if (!SHOTS) return;
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/${name}-light.png` });
  if (dark) {
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/${name}-dark.png` });
    await page.emulateMedia({ colorScheme: 'light' });
  }
}

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
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

const bankRow = (lemma: string, meaning: string, seq: number): BankRowSeed => ({
  lemma_norm: lemma,
  pos: 'verb',
  lemma,
  cefr: 'B1',
  list_source: 'cefrj',
  zipf: 3,
  lexicon_term_id: null,
  senses: [
    {
      meaning_tr: meaning,
      example_en: `They had to ${lemma} it.`,
      example_tr: `Bunu ${meaning} zorunda kaldılar.`,
      sense_id: null,
    },
  ],
  retired: false,
  server_seq: seq,
});

test('Add sheet: four groups; a typed word is looked up and becomes a card in the sheet', async ({
  page,
}) => {
  await serveWordBank(page, [bankRow('postpone', 'ertelemek', 1)]);
  await page.goto('/decks?tab=bank');
  await expect(page.getByTestId('word-bank-row').first()).toBeVisible();

  await page.goto('/');
  await page.getByTestId('nav-add').click();
  const sheet = page.getByRole('dialog', { name: 'Ne eklemek istersin?' });
  await expect(sheet.getByRole('heading', { level: 3 })).toHaveText([
    'Kelime ekle',
    'Metin ekle',
    'Kelimelerimle metin',
    'İçe aktar',
  ]);
  await noSideScroll(page);
  await shot(page, 'ekle-sheet', true);

  await sheet.getByTestId('add-word-input').fill('postponed');
  await sheet.getByRole('button', { name: 'Anlamını bul' }).click();
  await expect(sheet.getByText('ertelemek')).toBeVisible();
  await shot(page, 'ekle-word-result');
  await sheet.getByTestId('add-word-save').click();
  await expect(sheet.getByTestId('add-word-saved')).toContainText('postpone');
  const { notes, senses } = await dumpTables(page, ['notes', 'senses']);
  expect(notes).toEqual([expect.objectContaining({ term: 'postpone' })]);
  expect(senses).toEqual([expect.objectContaining({ meaning_tr: 'ertelemek' })]);
  await axe(page, 'add sheet');
});

/** A picked-v1 answer built from the request's own words (no live model). */
function pickedFor(targets: string[]) {
  const lines = targets.map((w, i) => `Mia: Did you ${w} it on day ${i + 1}? Sam: Yes, I did.`);
  const filler =
    'Mia: The weather was calm and the trees were green. Sam: We walked slowly and talked about school and food.';
  return {
    prompt_version: 'picked-v1',
    model: 'claude-haiku-test',
    story: {
      title: 'A Talk in the Park',
      paragraphs: [...lines, filler, filler],
      used_lemmas: targets,
      questions: [
        { q: 'Who talks?', options: ['Mia and Sam', 'Two teachers', 'A dog'], answer: 0 },
        { q: 'Where are they?', options: ['At sea', 'In a park', 'In a shop'], answer: 1 },
        { q: 'What do they talk about?', options: ['Cars', 'Money', 'School and food'], answer: 2 },
      ],
      glosses: targets.map((w) => ({ lemma: w, gloss_tr: 'anlamı' })),
    },
    usage: { used: 1, limit: 5 },
  };
}

async function addWord(page: Page, term: string, meaning: string) {
  await page.goto(`/add?term=${term}`);
  await page.getByLabel('Türkçe anlamı').fill(meaning);
  await page.getByRole('button', { name: 'Kartı kaydet' }).click();
  await expect(page.getByLabel('İngilizce kelime ya da kalıp')).toHaveValue('');
}

const WORDS: [string, string][] = [
  ['decide', 'karar vermek'],
  ['journey', 'yolculuk'],
  ['borrow', 'ödünç almak'],
  ['recipe', 'tarif'],
];

test('"Kelimelerimle metin oluştur": pick 3 words, a dialogue, read it with its questions', async ({
  context,
  page,
  backend,
}) => {
  void backend;
  await FakeBackend.signIn(context);
  const calls: Record<string, unknown>[] = [];
  await context.route(`${SUPABASE_URL}/functions/v1/ai-story`, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204 });
    const body = route.request().postDataJSON() as { target_lemmas: string[] };
    calls.push(body);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(pickedFor(body.target_lemmas)),
    });
  });
  for (const [term, meaning] of WORDS) await addWord(page, term, meaning);

  await page.goto('/metin-olustur');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Kelimelerimle metin oluştur');
  const recent = page.getByTestId('compose-recent');
  for (const w of ['decide', 'journey', 'borrow'])
    await recent.getByTestId('compose-word').filter({ hasText: w }).click();
  await expect(page.getByTestId('compose-tray')).toContainText('3/8');
  await noSideScroll(page);
  await shot(page, 'ekle-compose-pick');
  await axe(page, 'compose pick');
  await page.getByTestId('compose-next').click();

  await page.getByText('Diyalog', { exact: true }).click();
  await page.getByText(/^Kısa/).click();
  await expect(page.getByRole('radio', { name: 'Diyalog' })).toBeChecked();
  await expect(page.getByText(/Günde 5 metin oluşturabilirsin/)).toBeVisible();
  await shot(page, 'ekle-compose-options');
  await axe(page, 'compose options');
  await page.getByTestId('compose-make').click();

  await expect(page).toHaveURL(/\/oku\/[0-9a-f-]+$/, { timeout: 20_000 });
  await expect(page.getByRole('heading', { name: 'A Talk in the Park' })).toBeVisible();
  await expect(page.getByTestId('story-question')).toHaveCount(3);
  // What left the device: the picked words' dictionary forms, the form, the length, the level,
  // the difficulty and the topics. Nothing else.
  expect(calls.length).toBeGreaterThanOrEqual(1);
  expect(
    Object.keys(calls[0]!)
      .filter((k) => k !== 'avoid')
      .sort(),
  ).toEqual(['difficulty', 'genre', 'interests', 'length', 'level', 'source', 'target_lemmas']);
  expect(calls[0]).toMatchObject({ source: 'picked', genre: 'dialogue', length: 'short' });
  expect([...(calls[0]!.target_lemmas as string[])].sort()).toEqual([
    'borrow',
    'decide',
    'journey',
  ]);
});

test('a guest can pick words; making the text asks for sign-in', async ({ page }) => {
  for (const [term, meaning] of WORDS) await addWord(page, term, meaning);
  await page.goto('/metin-olustur');
  const recent = page.getByTestId('compose-recent');
  for (const w of ['decide', 'journey', 'borrow'])
    await recent.getByTestId('compose-word').filter({ hasText: w }).click();
  await page.getByTestId('compose-next').click();
  await expect(page.getByTestId('compose-signin')).toContainText('Metni oluşturmak için giriş yap');
  await expect(page.getByTestId('compose-make')).toHaveCount(0);
});

test('CSV / word list: a typed list becomes the user’s own cards, no account', async ({ page }) => {
  await page.goto('/import/csv');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('CSV ya da kelime listesi');
  await page
    .getByLabel('Ya da listeyi buraya yapıştır')
    .fill('give up - vazgeçmek\nbank;kıyı;We sat on the bank of the river.\nrecipe, tarif');
  await expect(page.getByText('3 kelime bulundu')).toBeVisible();
  await noSideScroll(page);
  await shot(page, 'ekle-csv');
  await page.getByTestId('word-list-add').click();
  await expect(page.getByTestId('word-list-done')).toContainText('3 yeni kelime eklendi');
  const { notes } = await dumpTables(page, ['notes']);
  expect(notes!.map((n) => (n as { term: string }).term).sort()).toEqual([
    'bank',
    'give up',
    'recipe',
  ]);
});
