import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import { dumpTables, expect, test } from './support/app.ts';
import { SUPABASE_URL } from './support/backend.ts';

// v0.4 Kelime Bankası (decision 0038): a guest downloads the public bank, browses their level
// (B1 by default), adds a word and a level-mix of ten, and the bank keeps working without the
// network once downloaded. public.word_bank is answered here; the rest is the fake backend.

const sense = (lemma: string, meaning: string) => ({
  meaning_tr: meaning,
  example_en: `We talked about the ${lemma} yesterday.`,
  example_tr: `Dün ${meaning} hakkında konuştuk.`,
  sense_id: null,
});

let seq = 0;
const bankRow = (lemma: string, cefr: string, meaning: string, zipf: number) => ({
  lemma_norm: lemma,
  pos: 'noun',
  lemma,
  cefr,
  list_source: cefr.startsWith('C') ? 'octanove' : 'cefrj',
  zipf,
  lexicon_term_id: null,
  senses: [sense(lemma, meaning)],
  retired: false,
  server_seq: ++seq,
});

const BANK = [
  bankRow('opinion', 'B1', 'görüş', 4.9),
  bankRow('journey', 'B1', 'yolculuk', 4.6),
  bankRow('festival', 'B1', 'şenlik', 4.4),
  ...Array.from({ length: 12 }, (_, i) => bankRow(`bword${i}`, 'B1', `bir anlam ${i}`, 4 - i / 10)),
  ...Array.from({ length: 10 }, (_, i) => bankRow(`aword${i}`, 'A2', `iki anlam ${i}`, 4)),
  ...Array.from({ length: 4 }, (_, i) => bankRow(`btwo${i}`, 'B2', `üç anlam ${i}`, 4)),
  ...Array.from({ length: 4 }, (_, i) => bankRow(`cone${i}`, 'C1', `dört anlam ${i}`, 3)),
];

/** Serves public.word_bank like PostgREST (server_seq > after, ascending, limit). */
async function serveBank(page: Page, state: { requests: string[]; down: boolean }) {
  await page.route(`${SUPABASE_URL}/rest/v1/word_bank**`, async (route: Route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204 });
    if (state.down) return route.abort('internetdisconnected');
    const url = new URL(req.url());
    state.requests.push(url.search);
    const after = Number((url.searchParams.get('server_seq') ?? 'gt.0').replace('gt.', ''));
    const limit = Number(url.searchParams.get('limit') ?? 1000);
    const rows = BANK.filter((r) => r.server_seq > after).slice(0, limit);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(rows),
    });
  });
}

test('Kelime Bankası: guest download, level list, add one, quick-add ten, offline reopen', async ({
  page,
}) => {
  const state = { requests: [] as string[], down: false };
  await serveBank(page, state);

  // The old /kelime-bankasi address opens Desteler's bank segment (v0.5.1: the add screen no
  // longer links it; the bank lives in Desteler / Kelimelerim).
  await page.goto('/kelime-bankasi');
  await expect(page).toHaveURL(/\/decks\?tab=bank$/);
  await expect(page.getByRole('link', { name: 'Kelime Bankası' })).toHaveAttribute(
    'aria-current',
    'page',
  );

  const list = page.getByRole('list', { name: 'Kelimeler' });
  await expect(list.getByTestId('word-bank-row').first()).toBeVisible();
  expect(state.requests).toHaveLength(1);
  expect(state.requests[0]).toContain('server_seq=gt.0');
  expect(state.requests[0]).toContain('list_source');

  // The guest's level (B1 by default), most frequent first, with its meaning.
  await expect(page.getByRole('button', { name: 'B1', pressed: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'B1 · 15 kelime' })).toBeVisible();
  const terms = list.getByTestId('word-bank-row').locator('[lang="en"]');
  await expect(terms.first()).toHaveText('opinion');
  const opinion = list.getByTestId('word-bank-row').filter({ hasText: 'opinion' });
  await expect(opinion.getByText('görüş')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Kaynaklar' })).toBeVisible();

  // One word, from its details: the card is made through the normal add path, then it leaves.
  await opinion.getByRole('button', { name: /^opinion/, expanded: false }).click();
  await opinion.getByRole('button', { name: 'opinion ekle' }).click();
  await expect(page.getByText('opinion eklendi', { exact: true })).toBeVisible();
  await expect(terms.first()).toHaveText('journey');

  // Ten in the level mix: none above B2, at most one B2, never a word already carded.
  await page.getByTestId('word-bank-quick').getByRole('button', { name: '10 kelime ekle' }).click();
  await expect(page.getByText('10 kelime eklendi', { exact: true })).toBeVisible();
  const { notes } = await dumpTables(page, ['notes']);
  const added = (notes as { term: string; deleted_at?: number | null }[]).map((n) => n.term);
  expect(added).toHaveLength(11);
  expect(added.filter((t) => t === 'opinion')).toHaveLength(1);
  expect(added.filter((t) => t.startsWith('cone'))).toHaveLength(0);
  expect(added.filter((t) => t.startsWith('btwo')).length).toBeLessThanOrEqual(1);

  // Reopened without the network: the bank comes from the device, nothing is asked.
  state.down = true;
  await page.goto('/decks?tab=bank');
  await page.getByRole('button', { name: 'A2', pressed: false }).click();
  await expect(page.getByRole('heading', { name: /^A2 · \d+ kelime$/ })).toBeVisible();
  await expect(terms.first()).toBeVisible();
  expect(state.requests).toHaveLength(1);
});

test('Keşfet: a suggested deck adds only new words, once, and shows up in Destelerim', async ({
  page,
}) => {
  await serveBank(page, { requests: [], down: false });
  // One word is already on a card, one is "Biliyorum".
  await page.goto('/decks?tab=bank');
  const list = page.getByRole('list', { name: 'Kelimeler' });
  const opinion = list.getByTestId('word-bank-row').filter({ hasText: 'opinion' });
  await opinion.getByRole('button', { name: /^opinion/, expanded: false }).click();
  await opinion.getByRole('button', { name: 'opinion ekle' }).click();
  await expect(page.getByText('opinion eklendi', { exact: true })).toBeVisible();

  // Suggested decks live in the Keşfet tab, under "Desteler".
  await page.getByRole('navigation', { name: 'Ana gezinme' }).first().getByRole('link', { name: 'Keşfet', exact: true }).click();
  await page.getByRole('navigation', { name: 'Keşfet süzgeci' }).getByRole('link', { name: 'Desteler' }).click();
  await expect(page).toHaveURL(/\/kesfet\?f=desteler$/);
  await page.getByRole('link', { name: /^B1 kelimeleri/ }).click();
  await expect(page).toHaveURL(/\/decks\/suggested\/level-b1$/);
  await expect(page.getByRole('heading', { level: 1, name: 'B1 kelimeleri' })).toBeVisible();
  await page.getByRole('button', { name: /Bildiklerimi işaretle/ }).click();
  await page.getByRole('button', { name: 'journey: biliyorum' }).click();
  await page.getByRole('button', { name: 'Taramayı bitir' }).click();
  await expect(page.getByRole('button', { name: 'Biliyorsun 1' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Çalışıyorsun 1' })).toBeVisible();

  await page.getByRole('button', { name: 'Destelerime ekle' }).click();
  await expect(page.getByText('“B1 kelimeleri” destelerine eklendi', { exact: true })).toBeVisible();
  const { notes, decks } = await dumpTables(page, ['notes', 'decks']);
  const terms = (notes as { term: string; tags: string[] }[]).map((n) => n.term);
  expect(terms).toHaveLength(14); // 15 B1 words − journey (known); opinion only once
  expect(terms.filter((t) => t === 'opinion')).toHaveLength(1);
  expect(terms).not.toContain('journey');
  expect(
    (notes as { term: string; tags: string[] }[]).every((n) => n.tags.includes('B1 kelimeleri')),
  ).toBe(true);
  expect(decks).toEqual([
    expect.objectContaining({ name: 'B1 kelimeleri', filter: { v: 1, tags: ['B1 kelimeleri'] } }),
  ]);
  await expect(page.getByRole('button', { name: 'Destelerime ekle' })).toHaveCount(0);

  await page.getByRole('link', { name: /Destelerimde aç/ }).click();
  await expect(page).toHaveURL(/\/decks\/[^/?]+$/);
  await expect(page.getByRole('heading', { level: 1, name: 'B1 kelimeleri' })).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Destedeki kelimeler' }).getByRole('listitem'),
  ).toHaveCount(14);
});

for (const [width, scheme] of [
  [360, 'light'],
  [1280, 'dark'],
] as const) {
  test(`Kelime Bankası: axe at ${width}px ${scheme}, details open and words selected`, async ({
    page,
  }) => {
    await serveBank(page, { requests: [], down: false });
    await page.setViewportSize({ width, height: width < 768 ? 780 : 860 });
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/decks?tab=bank');
    const list = page.getByRole('list', { name: 'Kelimeler' });
    await expect(list.getByTestId('word-bank-row').first()).toBeVisible();
    await list.getByRole('button', { name: /^opinion/, expanded: false }).click();
    await page.getByRole('button', { name: 'journey seç' }).click();
    await page.getByRole('button', { name: 'festival seç' }).click();
    await expect(page.getByRole('region', { name: 'Seçilen kelimeler' })).toBeVisible();
    await page.waitForTimeout(400);
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(
      violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
    ).toEqual([]);
  });
}
