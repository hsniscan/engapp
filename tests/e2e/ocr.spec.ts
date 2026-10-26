// "Fotoğraftan metin" on the web (v0.5 İP3, decision 0045): the real tesseract.js engine in the
// production build, on a page photo drawn in the browser. Checks that every OCR file comes from
// our own origin (no CDN, the photo is not uploaded), that the review screen shows the lines with
// the hyphenated word joined, and that "Okuyucuda aç" saves an 'ocr' text and opens /oku/:id.
// The Android path (ML Kit) is the same screen with another recogniser.
import { expect, test, dumpTables } from './support/app.ts';

test.use({ viewport: { width: 360, height: 740 } });

const LINES = [
  'It was a bright cold day in April, and the',
  'clocks were striking thirteen. Winston Smith,',
  'his chin nuzzled into his breast in an effort to',
  'escape the vile wind, slipped quickly through',
  'the glass doors of Victory Mansions, though',
  'not quickly enough to prevent a swirl of grit-',
  'ty dust from entering along with him.',
];

test('a page photo is read on the device and opens in the reader', async ({ page }) => {
  test.setTimeout(150_000);
  const foreign: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.protocol.startsWith('http') && u.hostname !== 'localhost') foreign.push(r.url());
  });

  await page.goto('/');
  await page.getByTestId('nav-add').click();
  await page.getByTestId('add-way-photo').click();
  await expect(page).toHaveURL(/\/fotograf$/);
  await expect(page.getByRole('heading', { name: 'Fotoğraftan metin' })).toBeVisible();
  await expect(page.getByTestId('ocr-web-note')).toBeVisible();

  // A "book page": serif text, black on off-white, 1200 px wide.
  const png = await page.evaluate((lines) => {
    const c = document.createElement('canvas');
    c.width = 1200;
    c.height = 140 + lines.length * 56;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#f7f3ea';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#1b1b1b';
    ctx.font = '34px serif';
    lines.forEach((l, i) => ctx.fillText(l, 70, 100 + i * 56));
    return c.toDataURL('image/png').split(',')[1]!;
  }, LINES);

  await page.getByTestId('ocr-gallery-input').setInputFiles({
    name: 'page.png',
    mimeType: 'image/png',
    buffer: Buffer.from(png, 'base64'),
  });
  await expect(page.getByRole('status').filter({ hasText: 'Metin okunuyor' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Okunan metni kontrol et' })).toBeVisible({
    timeout: 120_000,
  });

  const rows = page.getByTestId('ocr-line');
  await expect(rows).toHaveCount(LINES.length);

  // Word accuracy on a clean page (plan criterion 4 asks ≥ 95 % on real photos).
  const got = (await rows.allInnerTexts()).join(' ').split(/\s+/);
  const want = LINES.join(' ').split(/\s+/);
  const pool = new Map<string, number>();
  for (const w of got) pool.set(w, (pool.get(w) ?? 0) + 1);
  const hits = want.filter((w) => {
    const n = pool.get(w) ?? 0;
    if (n > 0) pool.set(w, n - 1);
    return n > 0;
  }).length;
  expect(hits / want.length).toBeGreaterThanOrEqual(0.95);

  await page.getByTestId('ocr-open-reader').click();
  await expect(page).toHaveURL(/\/oku\/[^/]+$/);
  const { texts } = (await dumpTables(page, ['texts'])) as {
    texts: { kind: string; body: string }[];
  };
  expect(texts).toHaveLength(1);
  expect(texts[0]!.kind).toBe('ocr');
  expect(texts[0]!.body).toContain('a swirl of gritty dust');
  expect(texts[0]!.body).not.toContain('\n');

  expect(foreign).toEqual([]);
});
