// v0.5.1 information architecture (ADR 0057), as the user sees it on a phone: the tab bar
// Bugün · Kelimelerim · (+) · Keşfet · Profil, Keşfet's feed and its four filters, Kelimelerim's
// two segments on one line, İlerleme at the top of Profil, the old addresses, and axe on Keşfet
// and Kelimelerim in both themes. With SHOTS_DIR=<dir> it also writes screenshots there.
import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import { addWord, expect, test, WORDS } from './support/app.ts';
import { SUPABASE_URL } from './support/backend.ts';

const PHONE = { width: 390, height: 844 };
const SHOTS = process.env.SHOTS_DIR;

let seq = 0;
const bankRow = (lemma: string, cefr: string, pos: string, meaning: string, zipf: number) => ({
  lemma_norm: lemma,
  pos,
  lemma,
  cefr,
  list_source: 'cefrj',
  zipf,
  lexicon_term_id: null,
  senses: [
    {
      meaning_tr: meaning,
      example_en: `She talked about the ${lemma} again.`,
      example_tr: `Yine ${meaning} hakkında konuştu.`,
      sense_id: null,
    },
  ],
  retired: false,
  server_seq: ++seq,
});

const BANK = [
  bankRow('persuade', 'B1', 'verb', 'ikna etmek', 4.4),
  bankRow('recommend', 'B1', 'verb', 'tavsiye etmek', 4.6),
  bankRow('arrange', 'B1', 'verb', 'düzenlemek', 4.3),
  bankRow('journey', 'B1', 'noun', 'yolculuk', 4.6),
  bankRow('opinion', 'B1', 'noun', 'görüş', 4.9),
  bankRow('festival', 'B1', 'noun', 'şenlik', 4.4),
  bankRow('generous', 'B1', 'adjective', 'cömert', 4.2),
  bankRow('gradually', 'B1', 'adverb', 'yavaş yavaş', 4.1),
  bankRow('borrow', 'A2', 'verb', 'ödünç almak', 4.5),
  bankRow('village', 'A2', 'noun', 'köy', 4.4),
  bankRow('reluctant', 'B2', 'adjective', 'isteksiz', 3.9),
];

async function serveBank(page: Page) {
  await page.route(`${SUPABASE_URL}/rest/v1/word_bank**`, async (route: Route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204 });
    const url = new URL(route.request().url());
    const after = Number((url.searchParams.get('server_seq') ?? 'gt.0').replace('gt.', ''));
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(BANK.filter((r) => r.server_seq > after)),
    });
  });
}

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const graded = (n: number, level: string, topic: string, title: string) => ({
  id: ID(n),
  level,
  topic,
  title,
  words: 180 + n,
  tokens: 170 + n,
  cov_level: 0.97,
  lemma_profile: { the: 20, train: 4, late: 3, station: 2, [`rare${n}`]: 1 },
  target_lemmas: ['station'],
  status: 'approved',
  server_seq: n,
  sentences: [
    { en: 'The train was late.', tr: 'Tren geç kaldı.', audio_key: null, p: 0 },
    { en: 'We waited at the station.', tr: 'İstasyonda bekledik.', audio_key: null, p: 0 },
  ],
  glosses: [],
});

async function axe(page: Page, name: string) {
  await page.waitForTimeout(300);
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
    name,
  ).toEqual([]);
}

async function shot(page: Page, name: string, full = false) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full });
}

const tabBar = (page: Page) => page.getByRole('navigation', { name: 'Ana gezinme' }).last();

test('tab bar: Bugün · Kelimelerim · (+) · Keşfet · Profil, and which tab each place belongs to', async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await page.goto('/');
  const bar = tabBar(page);
  await expect(bar.getByRole('listitem')).toHaveCount(5);
  await expect(bar.getByRole('link')).toHaveText(['Bugün', 'Kelimelerim', 'Keşfet', 'Profil']);
  await expect(bar.getByRole('button', { name: 'Ekle' })).toBeVisible();
  await expect(bar.getByRole('link', { name: 'İlerleme' })).toHaveCount(0);

  for (const [path, tab] of [
    ['/kesfet', 'Keşfet'],
    ['/kesfet?f=okuma', 'Keşfet'],
    ['/decks', 'Kelimelerim'],
    ['/decks?tab=bank', 'Kelimelerim'],
    ['/library', 'Kelimelerim'],
    ['/profile', 'Profil'],
    ['/progress', 'Profil'],
    ['/settings', 'Profil'],
  ] as const) {
    await page.goto(path);
    await expect(tabBar(page).getByRole('link', { name: tab, exact: true }), path).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(tabBar(page).locator('[aria-current="page"]'), path).toHaveCount(1);
  }

  // Old addresses land in their new places.
  for (const [from, to] of [
    ['/kitaplik', /\/kesfet\?f=okuma$/],
    ['/decks?tab=discover', /\/kesfet\?f=desteler$/],
    ['/decks?tab=reading', /\/kesfet\?f=okuma$/],
    ['/kelime-bankasi', /\/decks\?tab=bank$/],
  ] as const) {
    await page.goto(from);
    await expect(page, from).toHaveURL(to);
    await expect(page.getByRole('heading', { level: 1 }).first(), from).toBeVisible();
  }
});

test('Keşfet: the feed, each filter, and İlerleme at the top of Profil', async ({ page, backend }) => {
  test.setTimeout(150_000);
  await page.setViewportSize(PHONE);
  await serveBank(page);
  backend.graded.push(
    graded(1, 'A2', 'travel', 'The Late Train'),
    graded(2, 'B1', 'science', 'Why the Sky Is Blue'),
    graded(3, 'B1', 'daily_life', 'A Quiet Sunday'),
  );
  for (const w of WORDS) await addWord(page, w);

  await tabBar(page).getByRole('link', { name: 'Keşfet', exact: true }).click();
  await expect(page).toHaveURL(/\/kesfet$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Keşfet' })).toBeVisible();
  const chips = page.getByRole('navigation', { name: 'Keşfet süzgeci' });
  await expect(chips.getByRole('link')).toHaveText(['Hepsi', 'Okuma', 'Desteler', 'Kelimeler']);
  await expect(chips.getByRole('link', { name: 'Hepsi' })).toHaveAttribute('aria-current', 'page');

  // Hepsi: library texts, decks, the word of the day, the invitation to write a text.
  await expect(page.getByRole('region', { name: /Sana uygun metinler/ })).toBeVisible();
  await expect(page.getByTestId('kesfet-word')).toBeVisible();
  await expect(page.getByRole('region', { name: /Günün yanıltıcı benzeri/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Kelimelerimle metin oluştur' })).toBeVisible();
  await expect(page.getByRole('region', { name: /Hazır desteler/ })).toBeVisible();
  await expect(page.getByText(/Yakında/)).toHaveCount(0);
  await shot(page, 'kesfet-hepsi-light');
  await shot(page, 'kesfet-hepsi-light-full', true);

  // The word of the day goes into the cards with one tap.
  const word = page.getByTestId('kesfet-word');
  await word.getByRole('button', { name: 'Kartlarıma ekle' }).click();
  await expect(word.getByText('Kartlarına eklendi')).toBeVisible();

  // Kelimeler: only word cards.
  await chips.getByRole('link', { name: 'Kelimeler' }).click();
  await expect(page).toHaveURL(/\/kesfet\?f=kelimeler$/);
  await expect(page.getByTestId('kesfet-word')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Yeni kelimeler' })).toBeVisible();
  await expect(page.getByRole('region', { name: /Sana uygun metinler/ })).toHaveCount(0);

  // Desteler: every suggested deck.
  await chips.getByRole('link', { name: 'Desteler' }).click();
  await expect(page).toHaveURL(/\/kesfet\?f=desteler$/);
  await expect(page.getByRole('link', { name: /^B1 kelimeleri/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /En çok kullanılan 100 kelime/ })).toBeVisible();
  await expect(page.getByTestId('kesfet-word')).toHaveCount(0);

  // Okuma: the library (with its filters) and Metinlerim; a text opens in the reader, and the
  // reader's ✕ comes back here.
  await chips.getByRole('link', { name: 'Okuma' }).click();
  await expect(page).toHaveURL(/\/kesfet\?f=okuma$/);
  const library = page.getByRole('list', { name: 'Metinler', exact: true });
  await expect(library.getByRole('listitem')).toHaveCount(3);
  await expect(page.getByRole('heading', { name: 'Metinlerim' })).toBeVisible();
  await library.getByRole('listitem').filter({ hasText: 'The Late Train' }).getByRole('button').click();
  await expect(page).toHaveURL(/\/oku\//);
  await expect(tabBar(page)).toBeHidden();
  await page.goto('/kesfet?f=okuma');
  await expect(page.getByTestId('kesfet-continue')).toContainText('The Late Train');
  await expect(page.getByTestId('my-texts')).toContainText('The Late Train');

  // Profil opens with İlerleme; "Tümünü gör" is the full page.
  await tabBar(page).getByRole('link', { name: 'Profil', exact: true }).click();
  const progress = page.getByTestId('profile-progress');
  await expect(progress.getByRole('heading', { name: 'İlerleme' })).toBeVisible();
  await shot(page, 'profil-ilerleme-light');
  await progress.getByRole('link', { name: 'İlerleme: tümünü gör' }).click();
  await expect(page).toHaveURL(/\/progress$/);
  await expect(page.getByRole('heading', { level: 1, name: 'İlerleme' })).toBeVisible();
  await expect(tabBar(page).getByRole('link', { name: 'Profil', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('Keşfet offline: a friendly note and "Tekrar dene", never developer words', async ({
  page,
  backend,
}) => {
  await page.setViewportSize(PHONE);
  backend.offline = true;
  await page.route(`${SUPABASE_URL}/rest/v1/word_bank**`, (r) => r.abort('internetdisconnected'));
  await page.goto('/kesfet');
  const note = page.getByTestId('kesfet-missing');
  await expect(note).toContainText('Bazı öneriler internet gelince yüklenecek');
  await expect(note.getByRole('button', { name: 'Tekrar dene' })).toBeVisible();
  for (const f of ['', '?f=okuma', '?f=desteler', '?f=kelimeler']) {
    await page.goto(`/kesfet${f}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Keşfet' })).toBeVisible();
    await page.waitForTimeout(300);
    await expect(page.locator('main')).not.toContainText(/kurulum|backend|Yakında/i);
  }
});

test('Kelimelerim: two segments, "Kelime Bankası" on one line', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto('/decks');
  await expect(page.getByRole('heading', { level: 1, name: 'Kelimelerim' })).toBeVisible();
  const seg = page.getByRole('navigation', { name: 'Deste görünümü' });
  await expect(seg.getByRole('link')).toHaveText(['Destelerim', 'Kelime Bankası']);
  const bank = seg.getByRole('link', { name: 'Kelime Bankası' });
  const fits = await bank.evaluate((el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    const lines = new Set([...r.getClientRects()].map((x) => Math.round(x.top)));
    return { lines: lines.size, overflow: el.scrollWidth > el.clientWidth };
  });
  expect(fits).toEqual({ lines: 1, overflow: false });
  // A new user is not offered theme grouping of zero words.
  await expect(page.getByRole('link', { name: /temalara ayır/ })).toHaveCount(0);
  await shot(page, 'kelimelerim-light');
});

for (const scheme of ['light', 'dark'] as const) {
  test(`axe: Keşfet (every filter) and Kelimelerim at 390px, ${scheme}`, async ({ page, backend }) => {
    test.setTimeout(150_000);
    await page.setViewportSize(PHONE);
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await serveBank(page);
    backend.graded.push(graded(1, 'A2', 'travel', 'The Late Train'), graded(2, 'B1', 'science', 'Why the Sky Is Blue'));
    for (const w of WORDS) await addWord(page, w);
    for (const f of ['', '?f=okuma', '?f=desteler', '?f=kelimeler']) {
      await page.goto(`/kesfet${f}`);
      await expect(page.getByRole('heading', { level: 1, name: 'Keşfet' })).toBeVisible();
      if (f === '' || f === '?f=kelimeler') await expect(page.getByTestId('kesfet-word')).toBeVisible();
      if (f === '?f=okuma') await expect(page.getByRole('list', { name: 'Metinler', exact: true })).toBeVisible();
      if (f === '?f=desteler') await expect(page.getByRole('link', { name: /^B1 kelimeleri/ })).toBeVisible();
      await axe(page, `kesfet${f} ${scheme}`);
      if (scheme === 'dark' && f === '') await shot(page, 'kesfet-hepsi-dark');
    }
    for (const path of ['/decks', '/decks?tab=bank', '/profile']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await axe(page, `${path} ${scheme}`);
    }
  });
}
