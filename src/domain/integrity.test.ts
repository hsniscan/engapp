import { describe, expect, it } from 'vitest';
import { makeCard, makeLog, makeSense } from '../test/factories';
import { checkIntegrity } from './integrity';

describe('checkIntegrity', () => {
  it('reports a clean database as ok', () => {
    const r = checkIntegrity({
      notes: [{ id: 'n', deleted_at: null }],
      senses: [makeSense({ id: 's', note_id: 'n' })],
      cards: [makeCard({ id: 'c', note_id: 'n' }), makeCard({ id: 'p', note_id: 'n', sense_id: 's', card_type: 'production' })],
      logs: [makeLog({ card_id: 'c', reviewed_at: 1 })],
      outbox: [{ seq: 1, attempts: 2 }],
    });
    expect(r.ok).toBe(true);
  });

  it('finds orphans, missing recognition cards, logs without card and stuck outbox rows', () => {
    const r = checkIntegrity({
      notes: [{ id: 'n', deleted_at: null }, { id: 'gone', deleted_at: 5 }, { id: 'bare', deleted_at: null }],
      senses: [makeSense({ id: 'orphanSense', note_id: 'missing' }), makeSense({ id: 'dead', note_id: 'n', deleted_at: 1 })],
      cards: [
        makeCard({ id: 'c', note_id: 'n' }),
        makeCard({ id: 'orphan', note_id: 'missing' }),
        makeCard({ id: 'underDeleted', note_id: 'gone' }),
        makeCard({ id: 'deletedOk', note_id: 'missing', deleted_at: 3 }),
        makeCard({ id: 'noSense', note_id: 'n', sense_id: 'dead', card_type: 'cloze' }),
      ],
      logs: [makeLog({ id: 'lost', card_id: 'nowhere', reviewed_at: 1 })],
      outbox: [{ seq: 7, attempts: 10 }, { seq: 8, attempts: 1 }],
    });
    expect(r.ok).toBe(false);
    expect(r.orphanCards).toEqual(['orphan', 'underDeleted']);
    expect(r.orphanSenses).toEqual(['orphanSense']);
    expect(r.cardsWithoutSense).toEqual(['noSense']);
    expect(r.notesWithoutRecognition).toEqual(['bare']);
    expect(r.logsWithoutCard).toEqual(['lost']);
    expect(r.stuckOutbox).toEqual([7]);
  });
});
