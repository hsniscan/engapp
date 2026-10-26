import AxeBuilder from '@axe-core/playwright';
import { dumpTables, expect, test } from './support/app.ts';

// v0.5 graded library (decision 0047): a guest opens /kitaplik, the public catalogue comes down
// once, the level and topic filters narrow the list, every row has a coverage chip, and opening
// a text makes one reading row and caches its sentences for offline reading.

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const text = (n: number, level: string, topic: string, title: string) => ({
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
    { en: 'The train was late.', tr: 'Tren geç kaldı.', audio_key: 'en-US/aaa.mp3', p: 0 },
    { en: 'We waited at the station.', tr: 'İstasyonda bekledik.', audio_key: 'en-US/bbb.mp3', p: 0 },
  ],
  glosses: [],
});

test('Okuma kitaplığı: catalogue, filters, coverage chip, open and cache', async ({ page, backend }) => {
  backend.graded.push(
    text(1, 'A2', 'travel', 'The Late Train'),
    text(2, 'B1', 'science', 'Why the Sky Is Blue'),
    text(3, 'B2', 'business', 'A Meeting That Went Well'),
  );
  await page.goto('/kitaplik');
  await expect(page.getByRole('heading', { level: 1, name: 'Okuma kitaplığı' })).toBeVisible();

  const list = page.getByRole('list', { name: 'Metinler', exact: true });
  await expect(list.getByRole('listitem')).toHaveCount(3);
  // Easiest level first; one chip per text with the understood share and the fit.
  await expect(list.getByRole('listitem').first()).toContainText('The Late Train');
  await expect(list.getByTestId('coverage-chip')).toHaveCount(3);
  await expect(list.getByTestId('coverage-chip').first()).toHaveText(/^%\d+ anlaşılır · (Kolay|Uygun|Zor)$/);
  await expect(list.getByRole('listitem').first()).toContainText('A2 · Seyahat · 2 dk');

  // "Sana uygun" comes first: either suggestions or the note that none fits right now.
  await expect(page.getByRole('heading', { name: 'Sana uygun' })).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Sana uygun metinler' }).or(page.getByText(/tam uyan metin yok/)),
  ).toBeVisible();

  // Filters: level, then topic; an empty combination offers to clear them.
  const levels = page.getByRole('group', { name: 'Seviye' });
  await levels.getByRole('button', { name: 'B1' }).click();
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list).toContainText('Why the Sky Is Blue');
  await page.getByRole('group', { name: 'Konu' }).getByRole('button', { name: 'İş İngilizcesi' }).click();
  await expect(page.getByText('Bu süzgeçlere uyan metin yok.')).toBeVisible();
  await page.getByRole('button', { name: 'Süzgeçleri temizle' }).click();
  await expect(list.getByRole('listitem')).toHaveCount(3);

  const axe = await new AxeBuilder({ page }).include('main').analyze();
  expect(axe.violations).toEqual([]);

  // Only the public catalogue was asked for; nothing about the guest went out.
  expect([...new Set(backend.calls.map((c) => c.name))]).toEqual(['/rest/v1/graded_texts']);

  // Open: one reading row for the library text, the reader's address, the body on the device.
  await list.getByRole('button', { name: /^The Late Train/ }).click();
  await expect(page).toHaveURL(/\/oku\/[^/]+$/);
  await expect
    .poll(async () => (await dumpTables(page, ['graded_bodies'])).graded_bodies!.length)
    .toBe(1);
  const { texts, graded_bodies } = await dumpTables(page, ['texts', 'graded_bodies']);
  expect(texts).toEqual([expect.objectContaining({ kind: 'graded', graded_id: ID(1), title: 'The Late Train', body: '' })]);
  expect(graded_bodies![0]).toMatchObject({
    id: ID(1),
    sentences: [expect.objectContaining({ en: 'The train was late.', audio_key: 'en-US/aaa.mp3' }), expect.anything()],
  });

  // Back in the library offline: it lists from the device and the text is marked offline-ready;
  // opening it again reuses the same reading row.
  backend.offline = true;
  await page.goto('/kitaplik');
  const first = list.getByRole('listitem').filter({ hasText: 'The Late Train' });
  await expect(first.getByText('İnternetsiz okunur')).toBeVisible();
  await first.getByRole('button').click();
  await expect(page).toHaveURL(new RegExp(`/oku/${(texts![0] as { id: string }).id}$`));
  expect((await dumpTables(page, ['texts'])).texts).toHaveLength(1);
});
