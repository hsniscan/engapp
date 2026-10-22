import { beforeEach, describe, expect, it } from 'vitest';
import { CardState } from '../domain/types';
import { makeCard, makeLog } from '../test/factories';
import { resetDb } from '../test/db';
import { db } from './db';
import { getReminderFacts, medianSeconds } from './reminder';

const NOW = Date.UTC(2026, 9, 20, 7);
const D = 86_400_000;

describe('reminder facts from the device', () => {
  beforeEach(resetDb);

  it('counts studied, live, unsuspended, unlocked cards like the server', async () => {
    await db.cards.bulkAdd([
      makeCard({ note_id: 'n', state: CardState.Review, due: NOW + 1000 }),
      makeCard({ note_id: 'n', state: CardState.Learning, due: NOW - 1000 }),
      makeCard({ note_id: 'n', state: CardState.New, due: NOW }),
      makeCard({ note_id: 'n', state: CardState.Review, due: NOW, suspended: true }),
      makeCard({ note_id: 'n', state: CardState.Review, due: NOW, deleted_at: NOW }),
      makeCard({ note_id: 'n', state: CardState.Review, due: NOW, unlocked: false }),
      makeCard({ note_id: 'n', state: CardState.Review, due: NOW + 30 * D }),
    ]);
    const f = await getReminderFacts(NOW);
    expect(f.dueTimes).toEqual([NOW - 1000, NOW + 1000]);
  });

  it('takes the last answered review (not undo rows) and the median pace', async () => {
    await db.review_logs.bulkAdd([
      makeLog({ card_id: 'c', reviewed_at: NOW - 3000, duration_ms: 4000 }),
      makeLog({ card_id: 'c', reviewed_at: NOW - 2000, duration_ms: 8000 }),
      makeLog({ card_id: 'c', reviewed_at: NOW - 1000, duration_ms: 1, undo_of: 'x' }),
    ]);
    const f = await getReminderFacts(NOW);
    expect(f.lastReviewAt).toBe(NOW - 2000);
    expect(f.secPerCard).toBe(6);
  });

  it('median caps answers at 60 s and is null without history', () => {
    expect(medianSeconds([])).toBeNull();
    expect(
      medianSeconds([{ duration_ms: 120_000 }, { duration_ms: 2000 }, { duration_ms: 4000 }]),
    ).toBe(4);
  });
});
