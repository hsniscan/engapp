/**
 * Acceptance criterion 10 (v0.3 İP9): a 10,000-card backup restores in < 15 s on a phone or
 * laptop (v0.2: ~80–100 s, one awaited write per row in one transaction).
 *
 * Data: the realistic seed of perf.spec.ts (10,002 cards, ~47,000 review logs, 18 MB JSON)
 * restored as a guest through Ayarlar → Veri → Geri yükle → Üzerine yaz. The time runs from
 * choosing the file to the "Geri yükleme tamamlandı" toast (file read, verify, write,
 * recompute, daily activity, outbox compaction).
 *
 * The time is measured inside the page (performance.measure entries of the read and the
 * apply step), so the test's own clicks and polling are not part of it. The bound asserted
 * here is generous (shared CI runners and busy sandboxes write IndexedDB several times slower
 * than a phone) and scales locally with the machine's load (support/perf.ts); the measured
 * time is printed and attached. E2E_RESTORE_MAX_MS overrides the base bound.
 *
 * Like the 10,000-card size of perf.spec.ts it runs locally, on CI only with E2E_PERF_10K=1,
 * so ordinary CI e2e jobs stay fast and free of timing flakes.
 */
import { writeFile } from 'node:fs/promises';
import { expect, test } from './support/app.ts';
import { restoreSeed } from './support/restore.ts';
import { budget, perfSlack, slackNow } from './support/perf.ts';

const BOUND_MS = Number(process.env.E2E_RESTORE_MAX_MS ?? 90_000);

test.skip(
  !!process.env.CI && !process.env.E2E_PERF_10K,
  '10,000-card restore runs on CI only with E2E_PERF_10K=1',
);

test('10,000 cards: restore from backup is fast and leaves a compact outbox', async ({ page }, info) => {
  const start = perfSlack();
  test.setTimeout(300_000 * start.factor);
  const seeded = await restoreSeed(page, 10_000, { timeoutMs: 240_000 * start.factor });

  // Guest: one outbox entry per restored row of the mutable tables, none for review logs
  // (the first sign-in queues every log), and no duplicates.
  const outbox = await page.evaluate(
    () =>
      new Promise<{ total: number; logs: number; distinct: number }>((resolve, reject) => {
        const open = indexedDB.open('engapp');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const req = open.result.transaction('outbox').objectStore('outbox').getAll();
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            const rows = req.result as { table: string; row_id: string }[];
            open.result.close();
            resolve({
              total: rows.length,
              logs: rows.filter((r) => r.table === 'review_logs').length,
              distinct: new Set(rows.map((r) => `${r.table}:${r.row_id}`)).size,
            });
          };
        };
      }),
  );

  const slack = slackNow(start);
  const result = { ...seeded, outbox, bound_ms: budget(BOUND_MS, slack), bound_reason: slack.reason };
  console.log(`[restore-perf] ${JSON.stringify(result)}`);
  await writeFile(info.outputPath('restore-perf.json'), JSON.stringify(result, null, 2));
  info.annotations.push({ type: 'perf', description: JSON.stringify(result) });

  expect(outbox.logs).toBe(0);
  expect(outbox.distinct).toBe(outbox.total);
  expect(outbox.total).toBeLessThan(seeded.cards * 2);
  expect(seeded.restoreMs).toBeLessThan(budget(BOUND_MS, slack));
});
