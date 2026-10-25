import { expect, type Page } from '@playwright/test';
import { buildSeedBackup } from './seed.ts';

/**
 * Restore a realistic seed backup (≈`cards` cards) through Ayarlar → Veri → Geri yükle.
 * restoreMs: the app's own read + apply time (performance.measure entries "engapp:restore-read"
 * and "engapp:restore-apply", src/features/settings/DataSection.tsx); wallMs: from choosing
 * the file to the toast, as the test saw it (includes its clicks and polling).
 */
export async function restoreSeed(page: Page, cards: number, opts: { timeoutMs?: number } = {}) {
  const backup = await buildSeedBackup(cards);
  const buffer = Buffer.from(JSON.stringify(backup));
  await page.goto('/settings/veri');
  await expect(page.getByText('Henüz yedek alınmadı')).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Geri yükle' }).click();
  const t0 = Date.now();
  await (
    await chooser
  ).setFiles({ name: `seed-${cards}.json`, mimeType: 'application/json', buffer });
  const dialog = page.getByRole('dialog', { name: 'Yedeği geri yükle' });
  await dialog.getByRole('button', { name: 'Üzerine yaz' }).click();
  await expect(page.getByText('Geri yükleme tamamlandı', { exact: true })).toBeVisible({
    timeout: opts.timeoutMs ?? 240_000,
  });
  const wallMs = Date.now() - t0;
  const inPage = await page.evaluate(() => {
    const last = (n: string) => performance.getEntriesByName(n, 'measure').at(-1)?.duration;
    const read = last('engapp:restore-read');
    const apply = last('engapp:restore-apply');
    return read === undefined || apply === undefined ? null : Math.round(read + apply);
  });
  return {
    restoreMs: inPage ?? wallMs,
    wallMs,
    bytes: buffer.length,
    logs: backup.tables.review_logs.length,
    cards: backup.tables.cards.length,
  };
}
