// v0.4 İP3 + İP4 at phone width (360 px): the picture beside the meaning on the card back, also
// offline (airplane mode, served by the service worker); the picture actions in the word detail
// with a recorded ai-image; and the admin review screen with swipes, keys and undo. Every
// backend call is the fake in support/backend.ts; no AI call. SHOTS=<dir> saves screenshots.
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './support/app.ts';
import { FakeBackend, type ImageReviewQueueRow } from './support/backend.ts';
import {
  ALT,
  cachedImageIds,
  imageId,
  lexSenseId,
  pictureBackup,
  pictureRow,
  restoreFile,
  SAMPLE_NAMES,
} from './support/images.ts';
import { SAMPLE_PICTURES } from '../../src/test/imageSamples.ts';

const SHOTS = process.env.SHOTS;
const PHONE = { width: 360, height: 780 };

async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(PHONE.width);
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

/** Screenshot in light and dark (SHOTS only), checking AA contrast in both. */
async function shots(page: Page, name: string) {
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.waitForTimeout(250);
    await axe(page, `${name} ${colorScheme}`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-${colorScheme}.png` });
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

test.describe('picture on the card', () => {
  test.use({ serviceWorkers: 'allow', viewport: PHONE });

  test('fetched after sync, shown beside the meaning, and still there in airplane mode', async ({ page, context, backend }) => {
    test.setTimeout(120_000);
    backend.images.push(
      pictureRow('apple'),
      pictureRow('umbrella'),
      pictureRow('bridge', { status: 'review' }),
      // Rejected rows never reach the client (the select asks for approved and review only).
      pictureRow('angry', { status: 'rejected' as never }),
    );
    await FakeBackend.signIn(context);
    await page.goto('/');
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await restoreFile(page, await pictureBackup(['apple', 'umbrella', 'bridge', 'angry']));

    const wanted = [pictureRow('apple').id, pictureRow('bridge').id, pictureRow('umbrella').id].sort();
    await expect.poll(() => cachedImageIds(page), { timeout: 30_000 }).toEqual(wanted);
    expect(backend.calls.some((c) => c.name === '/rest/v1/lexicon_images')).toBe(true);

    // Airplane mode, and a fresh load from the service worker.
    backend.offline = true;
    await context.setOffline(true);
    await page.goto('/');
    await expect(page.getByRole('status', { name: /Senkron durumu: Çevrimdışı/ })).toBeVisible();
    await page.getByRole('link', { name: 'Tekrara başla' }).click();

    const seen = new Map<string, boolean>();
    const summary = page.getByRole('heading', { name: 'Oturum tamamlandı' });
    for (let n = 0; n < 8; n++) {
      const showAnswer = page.getByRole('button', { name: 'Cevabı göster', disabled: false });
      await expect(showAnswer.or(summary)).toBeVisible();
      if (await summary.isVisible()) break;
      // "Görseli ön yüzde de göster" is off: no picture on the front.
      await expect(page.getByTestId('card-picture')).toHaveCount(0);
      await page.locator('body').press('Space');
      await expect(page.getByRole('group', { name: 'Ne kadar iyi hatırladın?' })).toBeVisible();
      const picture = page.getByTestId('meaning-with-picture').getByTestId('card-picture');
      if ((await picture.count()) > 0) {
        const img = picture.locator('img');
        await expect(img).toHaveAttribute('src', /^data:image\/svg\+xml,/);
        expect(await img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
        const alt = (await img.getAttribute('alt'))!;
        seen.set(alt, (await picture.getByText('Yeni', { exact: true }).count()) > 0);
        if (alt === ALT.umbrella) {
          await noHorizontalScroll(page);
          await shots(page, 'card-back-360');
        }
      }
      await page.locator('body').press('3');
    }
    expect(Object.fromEntries(seen)).toEqual({ [ALT.apple]: false, [ALT.umbrella]: false, [ALT.bridge]: true });
  });
});

test.describe('word detail: Görsel', () => {
  test.use({ viewport: PHONE });

  test('pick another picture, answer "Hayır", hide it, and draw a new one', async ({ page, context, backend }) => {
    test.setTimeout(120_000);
    const second = pictureRow('umbrella', { variant: 1, svg: SAMPLE_PICTURES.apple.svg, alt_tr: 'Şemsiye yerine bir elma' });
    backend.images.push(pictureRow('umbrella'), second);
    const drawn = pictureRow('umbrella', { variant: 2, status: 'review', svg: SAMPLE_PICTURES.between.svg, alt_tr: 'Yeni çizilmiş bir şemsiye' });
    backend.imageAnswers.push({ ok: false, reason: 'not_visual' }, { ok: true, image: drawn });
    await FakeBackend.signIn(context);
    await page.goto('/');
    await restoreFile(page, await pictureBackup(['umbrella', 'apple']));
    await expect.poll(() => cachedImageIds(page), { timeout: 30_000 }).toHaveLength(2);

    await page.goto('/library');
    await page.getByRole('list', { name: 'Notlar' }).getByText('umbrella', { exact: true }).click();
    const sheet = page.getByRole('dialog');
    const shown = sheet.getByTestId('image-shown');
    await expect(shown.getByRole('img', { name: ALT.umbrella })).toBeVisible();
    await shown.scrollIntoViewIfNeeded();
    await noHorizontalScroll(page);
    await shots(page, 'detail-picture-360');

    // Another variant becomes the one on the cards.
    await sheet.getByRole('button', { name: /^2\. görsel: Şemsiye yerine bir elma\. Bunu kullan$/ }).click();
    await expect(shown.getByRole('img', { name: 'Şemsiye yerine bir elma' })).toBeVisible();

    // "Hayır" asks why; the answer is synced as a verdict on the picture.
    await shown.getByRole('button', { name: 'Hayır' }).click();
    await shown.getByRole('group', { name: 'Neden anlatmıyor?' }).getByRole('button', { name: 'Başka bir anlamı gösteriyor' }).click();
    await expect(page.getByText('Teşekkürler, bu görsel artık kartlarında çıkmayacak.', { exact: true })).toBeVisible();
    await expect(shown.getByRole('img', { name: ALT.umbrella })).toBeVisible();
    await expect
      .poll(() => backend.pushedIds('content_feedback').length, { timeout: 20_000 })
      .toBeGreaterThan(0);

    // Hide, then show again.
    await sheet.getByRole('button', { name: 'Görseli gizle' }).click();
    await expect(sheet.getByText('Bu anlamın görselini gizledin; kartlarında görünmüyor.')).toBeVisible();
    await sheet.getByRole('button', { name: 'Görseli göster' }).click();
    await expect(shown).toBeVisible();

    // "Yeniden üret": a refusal in plain Turkish, then a new picture marked as new.
    await sheet.getByRole('button', { name: 'Yeniden üret' }).click();
    await expect(page.getByText('Bu anlam resimle anlatılabilecek bir şey değil, o yüzden görsel çizilmedi.', { exact: true })).toBeVisible();
    await sheet.getByRole('button', { name: 'Yeniden üret' }).click();
    await expect(page.getByText('Yeni görsel hazır ve kartlarına eklendi.', { exact: true })).toBeVisible();
    await expect(shown.getByRole('img', { name: 'Yeni çizilmiş bir şemsiye' })).toBeVisible();
    await expect(shown.getByText('Bu görsel yeni; henüz kimse gözden geçirmedi.')).toBeVisible();
    const asked = backend.calls.filter((c) => c.name === 'ai-image').map((c) => c.body);
    expect(asked).toEqual([{ sense_id: lexSenseId(SAMPLE_NAMES.indexOf('umbrella')) }, { sense_id: lexSenseId(SAMPLE_NAMES.indexOf('umbrella')) }]);
  });
});

test.describe('Görsel onayı (admin)', () => {
  test.use({ viewport: PHONE });

  const queue = (): ImageReviewQueueRow[] =>
    SAMPLE_NAMES.map((name, i) => ({
      image: pictureRow(name, { id: imageId(i, 9), status: 'review' }),
      lemma: SAMPLE_PICTURES[name].lemma,
      pos: SAMPLE_PICTURES[name].pos,
      gloss_tr: SAMPLE_PICTURES[name].gloss_tr,
    }));

  test('not an admin: no entry in Ayarlar and the page says so', async ({ page, context, backend }) => {
    backend.reviewQueue.push(...queue());
    await FakeBackend.signIn(context);
    await page.goto('/settings/gelismis');
    await expect.poll(() => backend.count('is_app_admin')).toBeGreaterThan(0);
    await expect(page.getByRole('link', { name: /Görsel onayı/ })).toHaveCount(0);
    await page.goto('/admin/images');
    await expect(page.getByText('Bu sayfa yalnızca yöneticiler için.')).toBeVisible();
    expect(backend.count('image_review_queue')).toBe(0);
  });

  test('swipe right approves, left rejects with a reason, down redraws; undo; keys', async ({ page, context, backend }) => {
    backend.imageAdmin = true;
    backend.reviewQueue.push(...queue());
    await FakeBackend.signIn(context);
    await page.goto('/settings/gelismis');
    await page.getByRole('link', { name: /Görsel onayı|Aç/ }).click();
    await expect(page).toHaveURL(/\/admin\/images$/);
    const card = page.getByTestId('review-card');
    await expect(card).toHaveAttribute('data-image-id', imageId(0, 9));
    await expect(card.getByText('elma', { exact: true })).toBeVisible();
    await expect(page.getByTestId('review-left')).toHaveText('6 görsel kaldı');
    await noHorizontalScroll(page);
    // The "Hesabına bağlandın" toast would cover the undo button in the screenshot.
    if (SHOTS) await page.getByText('Hesabına bağlandın').waitFor({ timeout: 10_000 }).catch(() => {});
    for (const close of await page.getByRole('button', { name: 'Bildirimi kapat' }).all()) await close.click();
    await shots(page, 'image-review-360');

    const swipe = async (dx: number, dy: number) => {
      const box = (await card.boundingBox())!;
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      for (let i = 1; i <= 6; i++) await page.mouse.move(x + (dx * i) / 6, y + (dy * i) / 6);
      await page.mouse.up();
    };
    await swipe(160, 0); // approve apple
    await expect(card).toHaveAttribute('data-image-id', imageId(1, 9));
    await swipe(-160, 0); // reject bridge…
    await page.getByTestId('reject-reasons').getByRole('button', { name: /Ne olduğu anlaşılmıyor/ }).click();
    await expect(card).toHaveAttribute('data-image-id', imageId(2, 9));
    await swipe(0, 160); // redraw climb
    await expect(card).toHaveAttribute('data-image-id', imageId(3, 9));
    await page.getByRole('button', { name: 'Geri al' }).click(); // …climb back
    await expect(card).toHaveAttribute('data-image-id', imageId(2, 9));
    await page.keyboard.press('ArrowRight'); // approve climb
    await page.getByRole('button', { name: 'Yeniden çiz' }).click(); // redraw angry
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('4'); // reject between: other
    await expect(card).toHaveAttribute('data-image-id', imageId(5, 9));
    await expect(page.getByTestId('review-left')).toHaveText('1 görsel kaldı');

    // Leaving sends the decision held back for undo.
    // One close control (the top bar's ✕), back to Ayarlar.
    await expect(page.getByRole('link', { name: 'Geri' })).toHaveCount(0);
    await page.getByRole('link', { name: 'Görsel onayından çık' }).click();
    await expect(page).toHaveURL(/\/settings/);
    await expect.poll(() => backend.reviewDecisions.length).toBe(5);
    expect(backend.reviewDecisions).toEqual([
      { id: imageId(0, 9), decision: 'approve', reason: null },
      { id: imageId(1, 9), decision: 'reject', reason: 'unclear' },
      { id: imageId(2, 9), decision: 'approve', reason: null },
      { id: imageId(3, 9), decision: 'redraw', reason: null },
      { id: imageId(4, 9), decision: 'reject', reason: 'other' },
    ]);
  });
});
