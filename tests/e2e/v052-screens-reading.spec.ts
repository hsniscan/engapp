// v0.5.2 wave 2 (W4): screenshots of every Keşfet / reading screen at 390 px, light and dark,
// with realistic seeded data (a signed-in learner with six review words, a graded library,
// Kelime Bankası, a daily story written by the mocked ai-story). Runs only with
// SHOTS_DIR=<dir>; it also checks there is no sideways scroll on each screen.
import type { Page, Route } from '@playwright/test';
import { buildBackup } from '../../src/domain/backup.ts';
import { applyRating, createScheduler, emptyFsrs } from '../../src/domain/fsrs.ts';
import { encodeHlc } from '../../src/domain/hlc.ts';
import type { Card, Note, ReviewLog, Sense } from '../../src/domain/types.ts';
import { expect, test } from './support/app.ts';
import { FakeBackend, SUPABASE_URL } from './support/backend.ts';
import { buildSeedBackup } from './support/seed.ts';

const SHOTS = process.env.SHOTS_DIR;
test.skip(!SHOTS, 'screenshots only (SHOTS_DIR)');
test.use({ viewport: { width: 390, height: 844 } });

const WORDS: [string, string][] = [
  ['decide', 'karar vermek'],
  ['journey', 'yolculuk'],
  ['borrow', 'ödünç almak'],
  ['nervous', 'gergin'],
  ['recipe', 'tarif'],
  ['improve', 'geliştirmek'],
];

async function learnerBackup(now: number) {
  const scheduler = createScheduler({ request_retention: 0.9, fsrs_params: null });
  const created = now - 2 * 3_600_000;
  const t = now - 3_600_000;
  const hlc = (ms: number) => encodeHlc({ ms, counter: 0, node: 'seed' });
  const base = (id: string, ms = created) => ({ id, user_id: null, created_at: ms, updated_at: ms, deleted_at: null, hlc: hlc(ms) });
  const notes: Note[] = [];
  const senses: Sense[] = [];
  const cards: Card[] = [];
  const logs: ReviewLog[] = [];
  WORDS.forEach(([w, tr], i) => {
    notes.push({ ...base(`n-${w}`), term: w, term_norm: w, term_type: 'word', lexicon_term_id: null, ipa: null, tags: [], possible_duplicate: false, level_override: null });
    senses.push({ ...base(`s-${w}`), note_id: `n-${w}`, sense_no: 1, lexicon_sense_id: null, pos: 'verb', gloss_en: null, meaning_tr: tr, meaning_tr_override: null, source_sentence: null, source_sentence_tr: null, span: null, source_id: null });
    const f = applyRating(scheduler, { id: `c-${w}`, ...emptyFsrs(created) }, 3, t + i);
    cards.push({ ...base(`c-${w}`), ...f, updated_at: t + i, hlc: hlc(t + i), note_id: `n-${w}`, sense_id: null, card_type: 'recognition', suspended: false, unlocked: true });
    logs.push({ id: `log-${w}`, user_id: null, card_id: `c-${w}`, rating: 3, reviewed_at: t + i, duration_ms: 4000, device_id: 'seed', undo_of: null, shown_sense_id: null, created_at: t + i, hlc: hlc(t + i) });
  });
  const settings = (await buildSeedBackup(3, now)).tables.settings[0]!;
  return buildBackup({ notes, senses, cards, review_logs: logs, sources: [], settings: [settings] }, { exported_at: now, device_id: 'seed' });
}

let seq = 0;
const bankRow = (lemma: string, cefr: string, pos: string, meaning: string, en: string, tr: string) => ({
  lemma_norm: lemma,
  pos,
  lemma,
  cefr,
  list_source: 'cefrj',
  zipf: 4.4,
  lexicon_term_id: null,
  senses: [{ meaning_tr: meaning, example_en: en, example_tr: tr, sense_id: null }],
  retired: false,
  server_seq: ++seq,
});
const BANK = [
  bankRow('harbour', 'B1', 'noun', 'liman', 'The boats rested in the harbour.', 'Tekneler limanda dinleniyordu.'),
  bankRow('persuade', 'B1', 'verb', 'ikna etmek', 'She persuaded him to stay.', 'Onu kalmaya ikna etti.'),
  bankRow('recommend', 'B1', 'verb', 'tavsiye etmek', 'Can you recommend a book?', 'Bir kitap tavsiye edebilir misin?'),
  bankRow('arrange', 'B1', 'verb', 'düzenlemek', 'We arranged a meeting.', 'Bir toplantı düzenledik.'),
  bankRow('opinion', 'B1', 'noun', 'görüş', 'In my opinion, it is fine.', 'Bence sorun yok.'),
  bankRow('festival', 'B1', 'noun', 'şenlik', 'The town has a summer festival.', 'Kasabanın bir yaz şenliği var.'),
  bankRow('generous', 'B1', 'adjective', 'cömert', 'He is very generous.', 'Çok cömerttir.'),
  bankRow('gradually', 'B1', 'adverb', 'yavaş yavaş', 'The room gradually got warmer.', 'Oda yavaş yavaş ısındı.'),
  bankRow('village', 'A2', 'noun', 'köy', 'They live in a small village.', 'Küçük bir köyde yaşıyorlar.'),
  bankRow('bakery', 'A2', 'noun', 'fırın', 'The bakery opens at six.', 'Fırın altıda açılır.'),
  bankRow('reluctant', 'B2', 'adjective', 'isteksiz', 'She was reluctant to leave.', 'Ayrılmaya isteksizdi.'),
];

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const S = (en: string, tr: string, p = 0) => ({ en, tr, audio_key: null, p });
const HARBOUR = [
  S('Every morning, Elif walks down to the old harbour before work.', 'Elif her sabah işten önce eski limana yürür.'),
  S('The fishermen are already back, and the air smells of salt and bread.', 'Balıkçılar çoktan dönmüştür ve hava tuz ve ekmek kokar.'),
  S('A small bakery stands at the corner, next to the blue boats.', 'Köşede, mavi teknelerin yanında küçük bir fırın vardır.', 0),
  S('The baker, Mr Demir, waves when he sees her.', 'Fırıncı Demir Bey onu görünce el sallar.', 1),
  S('He always keeps one warm simit for her, even on busy days.', 'Yoğun günlerde bile ona her zaman sıcak bir simit ayırır.', 1),
  S('Today he looks worried, and Elif asks him what is wrong.', 'Bugün endişeli görünüyor ve Elif ona neyin yanlış olduğunu sorar.', 1),
  S('"The festival is on Saturday," he says, "and my oven is broken."', '"Şenlik cumartesi," der, "ve fırınım bozuk."', 2),
  S('Elif thinks for a moment, then smiles.', 'Elif bir an düşünür, sonra gülümser.', 2),
  S('Her cousin repairs ovens, and she can persuade him to come tomorrow.', 'Kuzeni fırın tamir eder ve onu yarın gelmeye ikna edebilir.', 2),
  S('Mr Demir is so grateful that he gives her a whole bag of simit.', 'Demir Bey o kadar minnettar olur ki ona bir torba simit verir.', 3),
  S('She shares them with everyone at the office, and the day feels lighter.', 'Simitleri ofisteki herkesle paylaşır ve gün daha hafif geçer.', 3),
];
const catalogue = (n: number, level: string, topic: string, title: string, words: number, profile: Record<string, number>, sentences = HARBOUR) => ({
  id: ID(n),
  level,
  topic,
  title,
  words,
  tokens: words - 10,
  cov_level: 0.97,
  lemma_profile: profile,
  target_lemmas: ['harbour'],
  status: 'approved',
  server_seq: n,
  sentences,
  glosses: [{ word: 'fisherman', tr: 'balıkçı' }, { word: 'oven', tr: 'fırın (ocak)' }],
});
const common = { the: 30, a: 12, every: 2, morning: 2, walk: 3, old: 2, before: 2, work: 3, be: 10, and: 8, she: 6, he: 6 };
const GRADED = [
  catalogue(1, 'A2', 'daily_life', 'The Harbour Bakery', 160, { ...common, harbour: 2, bakery: 2, festival: 1, persuade: 1 }),
  catalogue(2, 'B1', 'travel', 'A Night Train to Kars', 240, { ...common, train: 4, journey: 3, snow: 2, ticket: 2 }),
  catalogue(3, 'B1', 'science', 'Why Bread Rises', 210, { ...common, yeast: 3, dough: 3, bubble: 2, gas: 2 }),
  catalogue(4, 'B2', 'culture', 'The Lost Recipe Book', 300, { ...common, recipe: 4, grandmother: 3, reluctant: 1, manuscript: 2 }),
  catalogue(5, 'A2', 'food', 'Breakfast in Three Cities', 180, { ...common, breakfast: 4, cheese: 2, tea: 3 }),
];

function storyFor(targets: string[]) {
  return {
    prompt_version: 'story-v1',
    model: 'claude-haiku-test',
    story: {
      title: 'The Map in the Drawer',
      paragraphs: [
        `Mert had to ${targets[0] ?? 'decide'} quickly: stay at home or start the ${targets[1] ?? 'journey'} to his grandfather's village. He was a little ${targets[3] ?? 'nervous'}, so he asked to ${targets[2] ?? 'borrow'} his sister's old map.`,
        `In the drawer, under the map, he found a ${targets[4] ?? 'recipe'} in his grandmother's handwriting. He smiled. Maybe this trip could ${targets[5] ?? 'improve'} more than his sense of direction.`,
      ],
      used_lemmas: targets,
      questions: [
        { q: 'What did Mert borrow?', options: ['A bicycle', 'An old map', 'A phone'], answer: 1 },
        { q: 'Where was he going?', options: ["To his grandfather's village", 'To the sea', 'To school'], answer: 0 },
        { q: 'What did he find in the drawer?', options: ['Money', 'A letter', 'A recipe'], answer: 2 },
      ],
      glosses: targets.map((w) => ({ lemma: w, gloss_tr: WORDS.find(([x]) => x === w)?.[1] ?? 'anlamı' })),
    },
    usage: { used: 1, limit: 1 },
  };
}

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

async function restoreFile(page: Page, file: unknown) {
  const buffer = Buffer.from(JSON.stringify(file));
  await page.goto('/settings/veri');
  await expect(page.getByText('Henüz yedek alınmadı')).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Geri yükle' }).click();
  await (await chooser).setFiles({ name: 'seed.json', mimeType: 'application/json', buffer });
  await page.getByRole('dialog', { name: 'Yedeği geri yükle' }).getByRole('button', { name: 'Üzerine yaz' }).click();
  await expect(page.getByText('Geri yükleme tamamlandı', { exact: true })).toBeVisible({ timeout: 60_000 });
}

/** Light and dark of the current screen; full = the whole page. */
async function shot(page: Page, name: string, full = false) {
  const overflow = await page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const wide = [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((el) => el.getBoundingClientRect().right > w + 1)
      .filter((el) => !el.closest('[class*="overflow-x-auto"]'))
      .slice(0, 5)
      .map((el) => `${el.tagName}.${el.className.toString().slice(0, 80)}`);
    return { by: document.documentElement.scrollWidth - w, wide };
  });
  expect(overflow.by, `${name}: sideways scroll ${overflow.wide.join(' | ')}`).toBeLessThanOrEqual(0);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SHOTS}/${name}-${scheme === 'light' ? 'acik' : 'koyu'}.png`, fullPage: full });
  }
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
}

test('W4 screens: Keşfet, library, reader, word sheet, settings, end of text, Metinlerim, daily story', async ({
  context,
  page,
  backend,
}) => {
  test.setTimeout(240_000);
  backend.graded.push(...GRADED);
  await FakeBackend.signIn(context);
  await context.route(`${SUPABASE_URL}/functions/v1/ai-story`, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204 });
    const body = route.request().postDataJSON() as { target_lemmas: string[] };
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(storyFor(body.target_lemmas)),
    });
  });
  await serveBank(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await restoreFile(page, await learnerBackup(Date.now()));

  // Keşfet before anything was read: suggestions, the story invitation, words, decks.
  await page.goto('/kesfet');
  await expect(page.getByTestId('kesfet-word')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('today-story')).toBeVisible();
  await shot(page, '01-kesfet-hepsi', true);

  // Okuma: Metinlerim empty, the library with search.
  await page.goto('/kesfet?f=okuma');
  await expect(page.getByTestId('library-search')).toBeVisible();
  await shot(page, '02-kesfet-okuma-bos', true);
  await page.getByTestId('library-search').fill('bread');
  await expect(page.getByRole('list', { name: 'Metinler', exact: true }).getByRole('listitem')).toHaveCount(1);
  await page.getByTestId('library-search').scrollIntoViewIfNeeded();
  await shot(page, '03-kitaplik-arama');
  await page.getByTestId('library-search').fill('zzz');
  await expect(page.getByText('Bu süzgeçlere uyan metin yok.')).toBeVisible();
  await shot(page, '04-kitaplik-sonuc-yok');
  await page.getByTestId('library-search').fill('');

  // The reader: a library text, legend once, then a word sheet.
  await page.getByRole('button', { name: /The Harbour Bakery/ }).first().click();
  await expect(page).toHaveURL(/\/oku\//);
  await expect(page.getByTestId('reader-coverage')).toBeVisible();
  await expect(page.getByTestId('reader-legend')).toBeVisible();
  await shot(page, '05-okuyucu-ilk-acilis');
  await page.getByTestId('reader-legend').getByRole('button', { name: 'Renk açıklamasını kapat' }).click();
  await page.getByTestId('reader-translate').click();
  await shot(page, '06-okuyucu-turkcesi');
  await page.getByTestId('reader-translate').click();

  await page.getByTestId('reader-text').getByText('harbour', { exact: true }).first().click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByTestId('reader-reveal')).toBeVisible();
  await shot(page, '07-kelime-tahmin');
  await sheet.getByTestId('reader-reveal').click();
  await expect(sheet.getByText('liman')).toBeVisible();
  await shot(page, '08-kelime-anlami');
  await sheet.getByTestId('reader-add-card').click();
  await expect(sheet.getByText('Bu kelime kartlarında var.')).toBeVisible();
  await page.keyboard.press('Escape');

  // A word with no meaning on the device: type one.
  await page.getByTestId('reader-text').getByText('simit', { exact: true }).first().click();
  await sheet.getByTestId('reader-reveal').click();
  await expect(sheet.getByTestId('reader-own-meaning')).toBeVisible();
  await shot(page, '09-kelime-anlam-yok');
  await page.keyboard.press('Escape');

  // Settings.
  await page.getByRole('button', { name: 'Okuma ayarları' }).click();
  await expect(page.getByRole('dialog', { name: 'Okuma ayarları' })).toBeVisible();
  await shot(page, '10-okuma-ayarlari');
  await page.keyboard.press('Escape');

  // End of text, then finished.
  await page.getByTestId('reader-finish').scrollIntoViewIfNeeded();
  await shot(page, '11-metin-sonu');
  await page.getByTestId('reader-finish').click();
  await expect(page.getByRole('button', { name: 'Çok zor' })).toBeVisible();
  await page.getByRole('button', { name: 'Çok kolay' }).click();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await shot(page, '12-metin-bitti');

  // Another text read halfway, so Metinlerim and "Devam et" have something.
  await page.goto('/kesfet?f=okuma');
  await page.getByRole('button', { name: /A Night Train to Kars/ }).first().click();
  await expect(page.getByTestId('reader-coverage')).toBeVisible();
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Okuyucuyu kapat' }).click();
  await page.goto('/kesfet?f=okuma');
  await expect(page.getByTestId('my-texts')).toBeVisible();
  await shot(page, '13-metinlerim', true);

  // The daily story: made from Keşfet, read with its glossary, questions and words.
  await page.goto('/kesfet');
  await expect(page.getByTestId('today-story-make')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('today-story-make').click();
  await expect(page).toHaveURL(/\/oku\//, { timeout: 20_000 });
  await expect(page.getByTestId('reader-coverage')).toContainText('Hedef kelimeler dışında');
  await shot(page, '14-hikaye');
  await page.getByTestId('story-end').scrollIntoViewIfNeeded();
  await page.getByTestId('story-question').first().getByRole('button').nth(1).click();
  await page.getByTestId('story-question').nth(1).getByRole('button').nth(2).click();
  await page.getByTestId('story-end').scrollIntoViewIfNeeded();
  await shot(page, '15-hikaye-sorular');

  // Keşfet again: Devam et + the story card, then the other filters.
  await page.goto('/kesfet');
  await expect(page.getByTestId('kesfet-continue')).toBeVisible({ timeout: 20_000 });
  await shot(page, '16-kesfet-devam', true);
  await page.goto('/kesfet?f=kelimeler');
  await expect(page.getByTestId('kesfet-word')).toBeVisible();
  await shot(page, '17-kesfet-kelimeler', true);
  await page.goto('/kesfet?f=desteler');
  await expect(page.getByRole('link', { name: /En çok kullanılan 100 kelime/ })).toBeVisible();
  await shot(page, '18-kesfet-desteler', true);
});
