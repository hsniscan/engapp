import { beforeEach, describe, expect, it } from 'vitest';
import { db, updateSettings } from '@/data';
import { LEECH_REST_MS } from '@/domain/leech';
import { CardState } from '@/domain/types';
import { resetDb } from '@/test/db';
import { makeCard } from '@/test/factories';
import { getNextDue } from './queries';

// 12:00 in Istanbul (day start 04:00): the 10-minute step is still today.
const NOW = Date.UTC(2026, 10, 26, 9);
const MIN = 60_000;
const DAY = 86_400_000;

describe('next due (summary and Bugün)', () => {
  beforeEach(async () => {
    await resetDb();
    await updateSettings({ timezone: 'Europe/Istanbul', daily_new_limit: 10 }, NOW - DAY);
  });

  it('announces a relearning step in 10 minutes', async () => {
    await db.cards.add(makeCard({ note_id: 'n', state: CardState.Relearning, due: NOW + 10 * MIN }));
    expect(await getNextDue(NOW)).toEqual({ kind: 'later', at: NOW + 10 * MIN });
  });

  it('a leech resting 30 days is not "in 10 minutes" nor "tomorrow" (ADR 0071)', async () => {
    await db.cards.add(
      makeCard({
        note_id: 'n',
        state: CardState.Relearning,
        due: NOW + 10 * MIN,
        lapses: 6,
        rest_until: NOW + LEECH_REST_MS,
      }),
    );
    expect(await getNextDue(NOW)).toEqual({ kind: 'date', day: '2026-12-26' });
    // 11 minutes later it still waits for the rest, not for tomorrow.
    expect(await getNextDue(NOW + 11 * MIN)).toEqual({ kind: 'date', day: '2026-12-26' });
  });

  it('a resting card does not hide the next real card', async () => {
    await db.cards.bulkAdd([
      makeCard({
        note_id: 'n',
        state: CardState.Relearning,
        due: NOW + 10 * MIN,
        rest_until: NOW + LEECH_REST_MS,
      }),
      makeCard({ note_id: 'm', state: CardState.Review, due: NOW + 3 * DAY }),
    ]);
    expect(await getNextDue(NOW)).toEqual({ kind: 'date', day: '2026-11-29' });
  });

  it('a rest that ended counts the card again', async () => {
    await db.cards.add(
      makeCard({
        note_id: 'n',
        state: CardState.Relearning,
        due: NOW - 40 * DAY,
        rest_until: NOW + 30 * MIN,
      }),
    );
    expect(await getNextDue(NOW)).toEqual({ kind: 'later', at: NOW + 30 * MIN });
  });
});
