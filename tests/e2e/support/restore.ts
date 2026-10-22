import { expect, type Page } from '@playwright/test';
import { buildSeedBackup } from './seed.ts';

/** Restore a realistic seed backup (≈`cards` cards) through Ayarlar → Veri → Geri yükle. */
export async function restoreSeed(page: Page, cards: number) {
  const backup = await buildSeedBackup(cards);
  const buffer = Buffer.from(JSON.stringify(backup));
  await page.goto('/settings#veri');
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
    timeout: 240_000,
  });
  return {
    restoreMs: Date.now() - t0,
    bytes: buffer.length,
    logs: backup.tables.review_logs.length,
    cards: backup.tables.cards.length,
  };
}
