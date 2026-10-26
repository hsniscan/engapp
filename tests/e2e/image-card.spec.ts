// v0.4 İP8 at phone width (360 px): a word the learner already recognises gets a picture card
// once its approved picture arrives (fetched from the fake backend); the session asks the word
// from the picture and the part of speech; hiding the picture takes the card away; turning the
// setting off and on removes and brings back the card. No AI call. SHOTS=<dir> saves screenshots.
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { buildBackup } from '../../src/domain/backup.ts';
import { emptyFsrs } from '../../src/domain/fsrs.ts';
import { encodeHlc } from '../../src/domain/hlc.ts';
import type { Card, Note, ReviewLog, Sense } from '../../src/domain/types.ts';
import { SAMPLE_PICTURES } from '../../src/test/imageSamples.ts';
import { expect, test } from './support/app.ts';
import { FakeBackend } from './support/backend.ts';
import { ALT, cachedImageIds, lexSenseId, pictureRow, restoreFile, SAMPLE_NAMES } from './support/images.ts';
import { buildSeedBackup } from './support/seed.ts';

const SHOTS = process.env.SHOTS;
const PHONE = { width: 360, height: 780 };
const DAY = 86_400_000;

/**
 * "apple", recognised two days ago: its recognition, production and cloze cards were all
 * answered "Kolay", so nothing is due today and the picture card is the only card to study.
 */
async function learnedApple(now = Date.now()) {
  const at = now - 2 * DAY;
  const hlc = (t: number) => encodeHlc({ ms: t, counter: 0, node: 'seed' });
  const base = (id: string) => ({ id, user_id: null, created_at: at - DAY, updated_at: at, deleted_at: null, hlc: hlc(at) });
  const s = SAMPLE_PICTURES.apple;
  const sentence = 'She put an apple in her bag.';
  const note: Note = { ...base('n-apple'), term: 'apple', term_norm: 'apple', term_type: 'word', lexicon_term_id: null, ipa: '/ˈæp.əl/', tags: [], possible_duplicate: false, level_override: null };
  const sense: Sense = {
    ...base('s-apple'),
    note_id: note.id,
    sense_no: 1,
    lexicon_sense_id: lexSenseId(SAMPLE_NAMES.indexOf('apple')),
    pos: s.pos,
    gloss_en: null,
    meaning_tr: s.gloss_tr,
    meaning_tr_override: null,
    source_sentence: sentence,
    source_sentence_tr: null,
    span: [sentence.indexOf('apple'), sentence.indexOf('apple') + 5],
    source_id: null,
  };
  const cards: Card[] = [];
  const logs: ReviewLog[] = [];
  for (const type of ['recognition', 'production', 'cloze'] as const) {
    const card: Card = {
      ...base(`c-apple-${type[0]}`),
      note_id: note.id,
      sense_id: type === 'recognition' ? null : sense.id,
      card_type: type,
      suspended: false,
      unlocked: true,
      ...emptyFsrs(at - DAY),
    };
    cards.push(card);
    logs.push({
      id: `0199f0a0-0000-7000-8000-0000000c000${cards.length}`,
      user_id: null,
      card_id: card.id,
      rating: 4,
      reviewed_at: at + cards.length * 60_000,
      duration_ms: 3000,
      device_id: 'seed',
      undo_of: null,
      shown_sense_id: type === 'recognition' ? sense.id : null,
      created_at: at,
      hlc: hlc(at + cards.length * 60_000),
    });
  }
  const settings = (await buildSeedBackup(3, now)).tables.settings[0]!;
  return buildBackup(
    { notes: [note], senses: [sense], cards, review_logs: logs, sources: [], settings: [settings] },
    { exported_at: now, device_id: 'seed' },
  );
}

/** Live picture cards in the local database (raw IndexedDB). */
function pictureCards(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open('engapp');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const req = db.transaction('cards', 'readonly').objectStore('cards').getAll();
    const rows = await new Promise<{ card_type: string; deleted_at: number | null }[]>((res) => (req.onsuccess = () => res(req.result)));
    db.close();
    return rows.filter((c) => c.card_type === 'image' && c.deleted_at === null).length;
  });
}

async function axe(page: Page, label: string) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
    label,
  ).toEqual([]);
}

async function shots(page: Page, name: string) {
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.waitForTimeout(250);
    await axe(page, `${name} ${colorScheme}`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-${colorScheme}.png` });
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

test.describe('picture recall card', () => {
  test.use({ viewport: PHONE });

  test('unlocks for a recognised word with an approved picture, is studied, and follows hide and the setting', async ({ page, context, backend }) => {
    test.setTimeout(150_000);
    backend.images.push(pictureRow('apple'));
    await FakeBackend.signIn(context);
    await page.goto('/');
    await restoreFile(page, await learnedApple());

    // The picture arrives, and with it the picture card.
    await expect.poll(() => cachedImageIds(page), { timeout: 30_000 }).toEqual([pictureRow('apple').id]);
    await expect.poll(() => pictureCards(page), { timeout: 30_000 }).toBe(1);

    // Picture cards are part of Üretim (redesign: one session per study type).
    await page.goto('/study?mode=production');
    await expect(page.getByText('Görseldeki kelimeyi bul')).toBeVisible();
    const front = page.getByRole('img', { name: ALT.apple });
    await expect(front).toHaveAttribute('src', /^data:image\/svg\+xml,/);
    await expect(page.getByText('Sözcük türü: isim')).toBeAttached();
    await expect(page.getByText('apple', { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(PHONE.width);
    await shots(page, 'image-card-front-360');

    // The English is typed; the result says so and suggests a button.
    await page.getByTestId('answer-input').fill('apple');
    await page.getByTestId('answer-input').press('Enter');
    await expect(page.getByRole('group', { name: /Ne kadar iyi hatırladın\?/ })).toBeVisible();
    await expect(page.getByText('Doğru', { exact: true })).toBeVisible();
    await expect(page.getByText('apple', { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId('meaning-with-picture').getByText('elma', { exact: true })).toBeVisible();
    await shots(page, 'image-card-back-360');
    await page.locator('body').press('4');
    await expect(page.getByRole('heading', { name: 'Oturum tamamlandı' })).toBeVisible();

    // Hiding the picture takes the card away; showing it again brings it back.
    await page.goto('/library');
    await page.getByRole('list', { name: 'Notlar' }).getByText('apple', { exact: true }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByRole('button', { name: 'Görseli gizle' }).click();
    await expect.poll(() => pictureCards(page)).toBe(0);
    await sheet.getByRole('button', { name: 'Görseli göster' }).click();
    await expect.poll(() => pictureCards(page)).toBe(1);

    // The setting (default on) removes every picture card and brings them back; it syncs.
    await page.goto('/settings/gorunum');
    const toggle = page.getByRole('switch', { name: /Görselden hatırlama kartları/ });
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await expect.poll(() => pictureCards(page)).toBe(0);
    await expect
      .poll(() => [...backend.rows.values()].some((r) => r.table === 'settings' && (r.row as { image_cards?: boolean }).image_cards === false), {
        timeout: 20_000,
      })
      .toBe(true);
    await toggle.click();
    await expect.poll(() => pictureCards(page)).toBe(1);
  });
});
