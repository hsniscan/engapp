// The e2e perf test (tests/e2e/perf.spec.ts) answers 20 cards in one session of the 1,000-card
// seed. The seed's review histories run up to `now`, so the number of due reviews depends on
// the time of day: minutes before the 04:00 day start almost nothing is due (CI on PR #6 ran
// out of cards there and hung until the test timeout). The seed must give a long enough
// session at any time.
import { describe, expect, it } from 'vitest';
import { buildSeedBackup } from '../../../tests/e2e/support/seed';
import { getStudyQueue, restoreBackup } from '@/data';
import { resetDb } from '@/test/db';

describe('perf seed (1,000 cards)', () => {
  it.each([
    ['just before the 04:00 Istanbul day start', '2026-10-22T00:50:00Z'],
    ['midday', '2026-10-22T09:00:00Z'],
  ])(
    'has more than 20 cards to study %s',
    async (_, iso) => {
      const now = Date.parse(iso);
      await resetDb();
      await restoreBackup(JSON.stringify(await buildSeedBackup(1000, now)), 'overwrite', now);
      const q = await getStudyQueue({}, now);
      expect(q.items.length).toBeGreaterThanOrEqual(30);
    },
    60_000,
  );
});
