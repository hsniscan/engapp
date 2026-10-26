// İP8 part 1: bulk tags on a phone, a smart deck with its own page and a practice source,
// and "Kelimelerimi temalara ayır" through the real ai-themes pipeline.
import { addWord, dumpTables, expect, reviewAll, test, type Word } from './support/app.ts';
import { FakeBackend } from './support/backend.ts';

const PHONE = { width: 390, height: 844 };

const OFFICE: Word[] = [
  { term: 'deadline', meaning: 'son teslim tarihi' },
  { term: 'colleague', meaning: 'iş arkadaşı' },
  { term: 'thrive', meaning: 'gelişmek' },
  { term: 'scarce', meaning: 'kıt' },
];

test('phone: bulk tag two words, make a deck of them, filter Cards and practise only that deck', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize(PHONE);
  for (const w of OFFICE) await addWord(page, w);
  // Study everything once so the words can be practised.
  await page.goto('/');
  await page.getByTestId('start-study').click();
  expect(await reviewAll(page, '4')).toBe(4);

  // Bulk tag: select two notes, "Etiket", create "iş", apply.
  await page.goto('/library');
  await page.getByRole('checkbox', { name: '“deadline” notunu seç' }).click();
  await page.getByRole('checkbox', { name: '“colleague” notunu seç' }).click();
  const bar = page.getByRole('region', { name: 'Seçili notlar için işlemler' });
  await expect(bar.getByText('2 not seçili')).toBeVisible();
  await bar.getByRole('button', { name: 'Etiket' }).click();
  const sheet = page.getByRole('dialog', { name: 'Etiketler' });
  await sheet.getByRole('textbox', { name: 'Etiket ara ya da yeni etiket yaz' }).fill('iş');
  await sheet.getByRole('textbox', { name: 'Etiket ara ya da yeni etiket yaz' }).press('Enter');
  await expect(sheet.getByRole('checkbox', { name: /#iş/ })).toBeChecked();
  await sheet.getByRole('button', { name: 'Uygula' }).click();
  await expect(page.getByText('2 notun etiketleri güncellendi', { exact: true })).toBeVisible();
  const { notes } = await dumpTables(page, ['notes']);
  const tagged = (notes as { term: string; tags: string[] }[])
    .filter((n) => n.tags.includes('iş'))
    .map((n) => n.term);
  expect(tagged.sort()).toEqual(['colleague', 'deadline']);

  // Deck: Desteler → "Yeni deste · Kurallarla", name + tag, live count, create.
  await page.goto('/decks');
  await page.getByRole('button', { name: /Kurallarla/ }).click();
  const editor = page.getByRole('dialog', { name: 'Yeni deste' });
  await editor.getByRole('textbox', { name: 'Adı' }).fill('İş kelimeleri');
  await expect(editor.getByText('Şu an 4 kelime bu desteye giriyor.')).toBeVisible();
  await editor.getByRole('button', { name: /#iş/ }).click();
  await expect(editor.getByText('Şu an 2 kelime bu desteye giriyor.')).toBeVisible();
  await editor.getByRole('button', { name: 'Oluştur' }).click();
  await expect(page.getByText('Deste oluşturuldu', { exact: true })).toBeVisible();
  const { decks } = await dumpTables(page, ['decks']);
  expect(decks).toEqual([
    expect.objectContaining({ name: 'İş kelimeleri', filter: { v: 1, tags: ['iş'] }, sort: 1 }),
  ]);

  // Saving opens the deck's own page: its two words, by stage.
  await expect(page).toHaveURL(/\/decks\/[^/?]+$/);
  const deckUrl = page.url();
  await expect(page.getByRole('heading', { level: 1, name: 'İş kelimeleri' })).toBeVisible();
  const words = page.getByRole('list', { name: 'Destedeki kelimeler' });
  await expect(words.getByRole('listitem')).toHaveCount(2);
  await expect(words.getByText('thrive')).toHaveCount(0);

  // Destelerim lists it; "Tüm kelimelerim" filtered to the deck shows the same two words.
  await page.goto('/decks');
  await expect(page.getByRole('link', { name: 'İş kelimeleri', exact: true })).toHaveAttribute(
    'href',
    new URL(deckUrl).pathname,
  );
  await page.goto(`/library?deck=${new URL(deckUrl).pathname.split('/').pop()}`);
  const list = page.getByRole('list', { name: 'Notlar' });
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(page.getByRole('link', { name: 'Desteyi aç' })).toBeVisible();

  // "Çalış" on the deck's page is today's word study of the deck only: both words were studied
  // today, and a new word outside the deck does not come up there (it does in word study).
  await addWord(page, { term: 'harsh', meaning: 'sert' });
  await page.goto(deckUrl);
  await page.getByRole('link', { name: 'Çalış' }).click();
  await expect(page).toHaveURL(/\/study\?mode=word&deck=[^&]+$/);
  await expect(
    page.getByRole('heading', { name: '“İş kelimeleri” destesinde bugünlük kart kalmadı' }),
  ).toBeVisible();
  await page.goto('/study?mode=word');
  await expect(page.getByRole('button', { name: 'Cevabı göster', disabled: false })).toBeVisible();
  await expect(page.getByText('harsh', { exact: true }).first()).toBeVisible();

  // A practice round over the deck (Tüm kelimelerim filtered to it): only its two words.
  await page.goto(`/library?deck=${new URL(deckUrl).pathname.split('/').pop()}`);
  await page.getByRole('link', { name: 'Pratik yap' }).click();
  await expect(page).toHaveURL(/\/practice\?source=deck&size=10&deck=/);
  const done = page.getByRole('heading', { name: 'Pratik bitti' });
  let answers = 0;
  for (; answers < 10; answers++) {
    const show = page.getByRole('button', { name: 'Cevabı göster', disabled: false });
    await expect(show.or(done)).toBeVisible();
    if (await done.isVisible()) break;
    await page.locator('body').press('Space');
    await expect(page.getByRole('group', { name: 'Bildin mi?' })).toBeVisible();
    await page.locator('body').press('2');
  }
  expect(answers).toBe(2);
  const { practice_logs } = await dumpTables(page, ['practice_logs']);
  expect((practice_logs as { mode: string }[]).map((p) => p.mode)).toEqual(['deck', 'deck']);

  // No horizontal scroll at phone width on the screens touched here.
  for (const path of ['/library', '/decks']) {
    await page.goto(path);
    await expect(page.locator('main')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      PHONE.width,
    );
  }
});

const THEME_WORDS: Word[] = [
  { term: 'loan', meaning: 'kredi' },
  { term: 'interest', meaning: 'faiz' },
  { term: 'mortgage', meaning: 'ipotek' },
  { term: 'anxious', meaning: 'endişeli' },
  { term: 'grateful', meaning: 'minnettar' },
  { term: 'furious', meaning: 'öfkeli' },
  { term: 'ticket', meaning: 'bilet' },
  { term: 'luggage', meaning: 'bagaj' },
  { term: 'scarce', meaning: 'kıt' },
];

test('themes: preview, rename, remove a word, reject a group → tags, with only words and glosses sent', async ({
  context,
  page,
  backend,
}) => {
  test.setTimeout(120_000);
  await FakeBackend.signIn(context);
  for (const w of THEME_WORDS) await addWord(page, w);

  await page.goto('/decks');
  await page.getByRole('link', { name: /AI ile temalara ayır/ }).click();
  await expect(page).toHaveURL(/\/decks\/themes$/);
  await expect(page.getByText('Etiketi olmayan 9 kelimen var.')).toBeVisible();
  await expect(page.getByText('Günlük AI hakkından 1 çağrı kullanır.')).toBeVisible();
  await page.getByRole('button', { name: 'Temalara ayır' }).click();

  const groups = page.getByRole('list', { name: 'Önerilen temalar' });
  await expect(groups.getByRole('region')).toHaveCount(3);
  expect(backend.count('ai-themes')).toBe(1);
  // What went over the wire: refs, terms and glosses only.
  const sent = JSON.stringify(backend.calls.find((c) => c.name === 'ai-themes')!.body);
  for (const secret of ['kredi', 'faiz', 'endişeli', 'note-', '"id"'])
    expect(sent).not.toContain(secret);
  expect(sent).toContain('"ref":"w1"');

  // Rename "Duygular", remove "furious" from it, reject "Yolculuk".
  const nameField = groups
    .getByRole('region', { name: /Duygular/ })
    .getByRole('textbox', { name: 'Etiket adı' });
  await nameField.fill('His ve duygu');
  await page.keyboard.press('Tab'); // leaving the field saves the name
  // The heading follows the name as it is typed.
  const feelings = groups.getByRole('region', { name: /His ve duygu/ });
  await feelings.getByRole('button', { name: '“furious” kelimesini gruptan çıkar' }).click();
  await expect(feelings.getByText('1 kelime çıkarıldı')).toBeVisible();
  await groups
    .getByRole('region', { name: /Yolculuk/ })
    .getByRole('button', { name: 'Reddet' })
    .click();
  await expect(page.getByText('Reddedildi; etiket eklenmeyecek.')).toBeVisible();

  // The preview survives leaving the page.
  await page.goto('/decks');
  await page.getByRole('link', { name: /Bekleyen bir önerin var/ }).click();
  await expect(page.getByRole('region', { name: /His ve duygu/ })).toBeVisible();
  expect(backend.count('ai-themes')).toBe(1);

  await page.getByRole('button', { name: '2 etiketi kaydet' }).click();
  await expect(page.getByText('2 etiket eklendi', { exact: true })).toBeVisible();
  const { notes, theme_previews } = await dumpTables(page, ['notes', 'theme_previews']);
  const tags = Object.fromEntries(
    (notes as { term: string; tags: string[] }[]).map((n) => [n.term, n.tags]),
  );
  expect(tags).toMatchObject({
    loan: ['Para ve bankacılık'],
    interest: ['Para ve bankacılık'],
    mortgage: ['Para ve bankacılık'],
    anxious: ['His ve duygu'],
    grateful: ['His ve duygu'],
    furious: [],
    ticket: [],
    luggage: [],
    scarce: [],
  });
  expect(theme_previews).toEqual([]);
});
