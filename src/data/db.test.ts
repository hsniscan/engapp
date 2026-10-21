import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { makeSense } from '../test/factories';
import { EngDb } from './db';

describe('Dexie schema', () => {
  it('opens with every table and the indexes the queries rely on', async () => {
    const d = new EngDb('schema-test');
    await d.open();
    expect(d.verno).toBe(2);
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

  it('v2 upgrade fills source_sentence_tr = null on existing senses and candidates', async () => {
    const name = 'upgrade-test';
    const v1 = new Dexie(name);
    v1.version(1).stores({
      senses: 'id, note_id, [note_id+lexicon_sense_id], lexicon_sense_id, deleted_at',
      import_candidates: 'id, job_id',
    });
    const { source_sentence_tr: _, ...old } = makeSense({ id: 's1', note_id: 'n1', source_sentence: 'I went to the bank.' });
    await v1.table('senses').add(old);
    await v1.table('import_candidates').add({ id: 'c1', job_id: 'j1', source_sentence: 'I went to the bank.' });
    v1.close();

    const d = new EngDb(name);
    await d.open();
    const sense = await d.senses.get('s1');
    expect(sense).toMatchObject({ source_sentence: 'I went to the bank.', source_sentence_tr: null });
    expect(await d.import_candidates.get('c1')).toMatchObject({ source_sentence_tr: null });
    expect(await d.outbox.count()).toBe(0);
    d.close();
    await d.delete();
  });
});
