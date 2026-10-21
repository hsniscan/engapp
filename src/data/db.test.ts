import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { makeSense } from '../test/factories';
import { EngDb } from './db';

describe('Dexie schema', () => {
  it('opens with every table and the indexes the queries rely on', async () => {
    const d = new EngDb('schema-test');
    await d.open();
    expect(d.verno).toBe(5);
    expect(d.tables.map((t) => t.name).sort()).toEqual(
      ['cards', 'chunk_cache', 'daily_activity', 'error_log', 'import_candidates', 'import_jobs', 'lexicon_cache', 'meta', 'notes', 'outbox', 'practice_logs', 'review_logs', 'senses', 'settings', 'sources', 'lexicon_examples', 'content_feedback', 'user_content', 'example_jobs'].sort(),
    );
    const idx = (table: string) => d.table(table).schema.indexes.map((i) => i.name);
    expect(idx('cards')).toEqual(expect.arrayContaining(['[state+due]', 'note_id', 'sense_id']));
    expect(idx('review_logs')).toEqual(expect.arrayContaining(['card_id', 'reviewed_at', 'undo_of']));
    expect(idx('practice_logs')).toEqual(expect.arrayContaining(['card_id', 'practiced_at', 'session_id']));
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

  it('v3 upgrade adds practice_logs and keeps every existing row', async () => {
    const name = 'upgrade-v3-test';
    // A database as v0.1 left it (version 2).
    const old = new Dexie(name);
    old.version(1).stores({ cards: 'id, note_id, sense_id, [state+due], due, card_type, deleted_at', review_logs: 'id, card_id, reviewed_at, undo_of', meta: 'key' });
    old.version(2).stores({});
    await old.open();
    await old.table('cards').add({ id: 'c1', note_id: 'n1', state: 2, due: 5 });
    await old.table('review_logs').add({ id: 'l1', card_id: 'c1', reviewed_at: 1, undo_of: null });
    old.close();

    const d = new EngDb(name);
    await d.open();
    expect(d.verno).toBeGreaterThanOrEqual(3);
    expect(await d.cards.get('c1')).toMatchObject({ state: 2, due: 5 });
    expect(await d.review_logs.count()).toBe(1);
    expect(await d.practice_logs.count()).toBe(0);
    d.close();
    await d.delete();
  });

  it('v5 adds the example sentence tables and keeps every existing row', async () => {
    const name = 'upgrade-v5-test';
    // A database as İP1 left it (version 3).
    const old = new Dexie(name);
    old.version(1).stores({ cards: 'id, note_id, sense_id, [state+due], due, card_type, deleted_at', meta: 'key' });
    old.version(2).stores({});
    old.version(3).stores({ practice_logs: 'id, card_id, practiced_at, session_id' });
    await old.open();
    await old.table('cards').add({ id: 'c1', note_id: 'n1', state: 2, due: 5 });
    await old.table('practice_logs').add({ id: 'p1', card_id: 'c1', practiced_at: 1, session_id: 's' });
    old.close();

    const d = new EngDb(name);
    await d.open();
    expect(d.verno).toBe(5);
    expect(await d.cards.get('c1')).toMatchObject({ state: 2, due: 5 });
    expect(await d.practice_logs.count()).toBe(1);
    expect(await d.lexicon_examples.count()).toBe(0);
    const idx = (table: string) => d.table(table).schema.indexes.map((i) => i.name);
    expect(idx('lexicon_examples')).toEqual(expect.arrayContaining(['sense_id', '[sense_id+level_band]']));
    expect(idx('content_feedback')).toEqual(expect.arrayContaining(['[target_kind+target_id]']));
    expect(idx('user_content')).toEqual(expect.arrayContaining(['replaces_id', 'lexicon_sense_id', 'kind']));
    expect(idx('example_jobs')).toEqual(expect.arrayContaining(['status', 'next_attempt_at']));
    d.close();
    await d.delete();
  });
});
