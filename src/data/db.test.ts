import { describe, expect, it } from 'vitest';
import { EngDb } from './db';

describe('Dexie schema v1', () => {
  it('opens with every table and the indexes the queries rely on', async () => {
    const d = new EngDb('schema-test');
    await d.open();
    expect(d.verno).toBe(1);
    expect(d.tables.map((t) => t.name).sort()).toEqual(
      ['cards', 'chunk_cache', 'daily_activity', 'error_log', 'import_candidates', 'import_jobs', 'lexicon_cache', 'meta', 'notes', 'outbox', 'review_logs', 'senses', 'settings', 'sources'].sort(),
    );
    const idx = (table: string) => d.table(table).schema.indexes.map((i) => i.name);
    expect(idx('cards')).toEqual(expect.arrayContaining(['[state+due]', 'note_id', 'sense_id']));
    expect(idx('review_logs')).toEqual(expect.arrayContaining(['card_id', 'reviewed_at', 'undo_of']));
    expect(d.table('notes').schema.indexes.find((i) => i.name === 'term_norm')?.unique).toBeFalsy();
    d.close();
    await d.delete();
  });
});
