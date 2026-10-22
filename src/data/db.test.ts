import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { makeCard, makeSense } from '../test/factories';
import { PULL_BACKFILL_KEY } from './backfill';
import { EngDb } from './db';

/** The current schema version; bump with every new Dexie version. */
const LATEST = 17;

describe('Dexie schema', () => {
  it('opens with every table and the indexes the queries rely on', async () => {
    const d = new EngDb('schema-test');
    await d.open();
    expect(d.verno).toBe(LATEST);
    expect(d.tables.map((t) => t.name).sort()).toEqual(
      ['cards', 'chunk_cache', 'daily_activity', 'error_log', 'import_candidates', 'import_jobs', 'lexicon_cache', 'meta', 'notes', 'outbox', 'practice_logs', 'ref_cache', 'review_logs', 'senses', 'settings', 'sources', 'lexicon_examples', 'content_feedback', 'user_content', 'example_jobs', 'decks', 'theme_previews', 'level_tests', 'known_terms', 'anki_imports', 'lexicon_pair_notes'].sort(),
    );
    const idx = (table: string) => d.table(table).schema.indexes.map((i) => i.name);
    expect(idx('decks')).toEqual(expect.arrayContaining(['sort', 'deleted_at']));
    expect(idx('cards')).toEqual(expect.arrayContaining(['[state+due]', 'note_id', 'sense_id']));
    expect(idx('review_logs')).toEqual(expect.arrayContaining(['card_id', 'reviewed_at', 'undo_of']));
    expect(idx('practice_logs')).toEqual(expect.arrayContaining(['card_id', 'practiced_at', 'session_id']));
    expect(d.table('notes').schema.indexes.find((i) => i.name === 'term_norm')?.unique).toBeFalsy();
    expect(idx('known_terms')).toEqual(expect.arrayContaining(['term_norm', 'deleted_at']));
    expect(idx('level_tests')).toEqual(expect.arrayContaining(['taken_at']));
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

  it('v4 upgrade fills level_override = null on notes and re-pulls the lexicon cache', async () => {
    const name = 'upgrade-v4-test';
    // A database as v0.2 İP1 left it (version 3).
    const old = new Dexie(name);
    old.version(1).stores({
      notes: 'id, term_norm, lexicon_term_id, updated_at, deleted_at, *tags',
      lexicon_cache: 'id, term_id, lemma_norm, updated_at',
      meta: 'key',
    });
    old.version(2).stores({});
    old.version(3).stores({ practice_logs: 'id, card_id, practiced_at, session_id' });
    await old.open();
    await old.table('notes').add({ id: 'n1', term: 'bank', term_norm: 'bank', tags: [], deleted_at: null });
    await old.table('lexicon_cache').add({ id: 'l1', term_id: 't1', lemma_norm: 'bank', updated_at: 1 });
    await old.table('meta').put({ key: 'lexicon_cursor', value: 1234 });
    old.close();

    const d = new EngDb(name);
    await d.open();
    expect(await d.notes.get('n1')).toMatchObject({ term: 'bank', level_override: null });
    expect(await d.lexicon_cache.get('l1')).toMatchObject({ lemma_norm: 'bank' });
    expect(await d.meta.get('lexicon_cursor')).toEqual({ key: 'lexicon_cursor', value: 0 });
    expect(await d.outbox.count()).toBe(0);
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
    expect(d.verno).toBe(LATEST);
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

  it('v6 upgrade adds ref_cache (pair_note_feedback is gone again in v8) and keeps the sync cursor', async () => {
    const name = 'upgrade-v6-test';
    const old = new Dexie(name);
    old.version(3).stores({ notes: 'id, term_norm', error_log: '++id, at', meta: 'key' });
    await old.open();
    await old.table('notes').add({ id: 'n1', term_norm: 'bank', term_type: 'word' });
    await old.table('meta').put({ key: 'sync_cursor', value: 420 });
    await old.table('error_log').add({ at: 1, message: 'x', stack: null, context: 'sync.pull invalid senses/s9' });
    old.close();

    const d = new EngDb(name);
    await d.open();
    expect(d.verno).toBe(LATEST);
    expect(await d.notes.get('n1')).toMatchObject({ term_norm: 'bank' });
    expect(await d.meta.get('sync_cursor')).toEqual({ key: 'sync_cursor', value: 420 });
    expect(await d.ref_cache.count()).toBe(0);
    expect(d.tables.map((t) => t.name)).not.toContain('pair_note_feedback');
    d.close();
    await d.delete();
  });

  it('v6 upgrade pulls again from the start when an older version skipped a note', async () => {
    // An older app could not read an affix note: it logged the row as invalid and moved on.
    const name = 'upgrade-v6-skipped';
    const old = new Dexie(name);
    old.version(3).stores({ notes: 'id, term_norm', error_log: '++id, at', meta: 'key' });
    await old.open();
    await old.table('meta').put({ key: 'sync_cursor', value: 420 });
    await old.table('error_log').add({ at: 1, message: 'invalid term_type', stack: null, context: 'sync.pull invalid notes/n7' });
    old.close();

    const d = new EngDb(name);
    await d.open();
    expect(await d.meta.get('sync_cursor')).toEqual({ key: 'sync_cursor', value: 0 });
    d.close();
    await d.delete();
  });

  it('fresh install: latest version, no backfill, sources topic index works', async () => {
    const d = new EngDb('fresh-install-test');
    await d.open();
    expect(d.verno).toBe(LATEST);
    expect(d.tables.map((t) => t.name)).not.toContain('pair_note_feedback');
    expect(await d.meta.count()).toBe(0);
    expect(d.sources.schema.indexes.find((i) => i.name === 'topics')?.multi).toBe(true);
    await d.sources.add({ id: 's1', created_at: 1, topics: ['travel', 'food'] } as never);
    expect((await d.sources.where('topics').equals('food').toArray()).map((x) => x.id)).toEqual(['s1']);
    d.close();
    await d.delete();
  });

  it('upgrades a v3 (v0.1 + İP1) database straight to the latest version with its data', async () => {
    const name = 'upgrade-from-v3';
    const old = new Dexie(name);
    old.version(1).stores({
      notes: 'id, term_norm, lexicon_term_id, updated_at, deleted_at, *tags',
      senses: 'id, note_id, [note_id+lexicon_sense_id], lexicon_sense_id, deleted_at',
      cards: 'id, note_id, sense_id, [state+due], due, card_type, deleted_at',
      review_logs: 'id, card_id, reviewed_at, undo_of',
      sources: 'id, created_at',
      settings: 'id',
      lexicon_cache: 'id, term_id, lemma_norm, updated_at',
      chunk_cache: 'chunk_hash, created_at',
      import_jobs: 'id, status, created_at',
      import_candidates: 'id, job_id',
      outbox: '++seq, [table+row_id], next_attempt_at',
      daily_activity: 'date',
      error_log: '++id, at',
      meta: 'key',
    });
    old.version(2).stores({});
    old.version(3).stores({ practice_logs: 'id, card_id, practiced_at, session_id' });
    await old.open();
    await old.table('notes').add({ id: 'n1', term: 'desk', term_norm: 'desk', tags: ['iş'], deleted_at: null });
    await old.table('senses').add(makeSense({ id: 'se1', note_id: 'n1', source_id: 'src1' }));
    await old.table('cards').add(makeCard({ id: 'c1', note_id: 'n1' }));
    await old.table('review_logs').add({ id: 'r1', card_id: 'c1', reviewed_at: 5, undo_of: null });
    await old.table('practice_logs').add({ id: 'p1', card_id: 'c1', practiced_at: 6, session_id: 'x' });
    await old.table('sources').add({ id: 'src1', created_at: 1, title: 'Text' });
    await old.table('settings').add({ id: 'settings', timezone: 'Europe/Istanbul' });
    await old.table('outbox').add({ table: 'notes', row_id: 'n1', next_attempt_at: 0 });
    await old.table('meta').bulkAdd([
      { key: 'sync_cursor', value: 42 },
      { key: 'lexicon_cursor', value: 9 },
    ]);
    old.close();

    const d = new EngDb(name);
    await d.open();
    expect(d.verno).toBe(LATEST);
    expect(d.tables.map((t) => t.name)).not.toContain('pair_note_feedback');
    expect(await d.notes.get('n1')).toMatchObject({ term: 'desk', tags: ['iş'], level_override: null });
    expect(await d.senses.get('se1')).toMatchObject({ source_id: 'src1' });
    expect(await d.cards.count()).toBe(1);
    expect(await d.review_logs.count()).toBe(1);
    expect(await d.practice_logs.count()).toBe(1);
    expect(await d.outbox.count()).toBe(1);
    expect(await d.settings.get('settings')).toMatchObject({ timezone: 'Europe/Istanbul' });
    expect((await d.sources.get('src1'))?.topics).toBeUndefined();
    expect((await d.meta.get('sync_cursor'))?.value).toBe(42);
    expect((await d.meta.get('lexicon_cursor'))?.value).toBe(0);
    expect((await d.meta.get(PULL_BACKFILL_KEY))?.value).toEqual(
      expect.arrayContaining(['content_feedback', 'user_content', 'decks', 'level_tests', 'known_terms']),
    );
    // v11: notes, settings and sources once more, for the columns v0.1/İP1 stripped.
    expect((await d.meta.get(PULL_BACKFILL_KEY))?.value).toEqual(expect.arrayContaining(['notes', 'settings', 'sources']));
    expect(await d.settings.get('settings')).toMatchObject({ level_source: 'default', level_locked: false });
    d.close();
    await d.delete();
  });

  it('v9 upgrade adds the level tables, fills the level fields and re-pulls them once', async () => {
    const name = 'upgrade-v9-test';
    const old = new Dexie(name);
    old.version(1).stores({ notes: 'id, term_norm, lexicon_term_id, updated_at, deleted_at, *tags', settings: 'id', meta: 'key' });
    old.version(4).stores({});
    await old.open();
    await old.table('settings').add({ id: 'settings', level: 'B2', theme: 'dark' });
    await old.table('notes').add({ id: 'n1', term_norm: 'cope', tags: [], level_override: null });
    await old.table('meta').bulkPut([
      { key: 'sync_cursor', value: 1234 },
      { key: 'lexicon_cursor', value: 99 },
    ]);
    old.close();

    const d = new EngDb(name);
    await d.open();
    expect(d.verno).toBe(LATEST);
    expect(await d.settings.get('settings')).toMatchObject({
      level: 'B2',
      theme: 'dark',
      // B2 was chosen by the user (the default is B1).
      level_source: 'manual',
      level_updated_at: null,
      level_locked: false,
      level_change: null,
    });
    expect(await d.notes.get('n1')).toMatchObject({ term_norm: 'cope' });
    // Built as a one-time sync-cursor reset; now the shared re-pull of the new tables.
    expect((await d.meta.get('sync_cursor'))?.value).toBe(1234);
    expect((await d.meta.get(PULL_BACKFILL_KEY))?.value).toEqual(
      expect.arrayContaining(['level_tests', 'known_terms']),
    );
    expect((await d.meta.get('lexicon_cursor'))?.value).toBe(99);
    expect(await d.level_tests.count()).toBe(0);
    expect(await d.known_terms.count()).toBe(0);
    expect(await d.outbox.count()).toBe(0);
    d.close();
    await d.delete();
  });

  it('v10 upgrade adds the smart-extraction fields to import candidates and keeps their selection', async () => {
    const name = 'upgrade-v10-test';
    // A database as v0.2 İP2 left it (version 4).
    const old = new Dexie(name);
    old.version(1).stores({ import_candidates: 'id, job_id', meta: 'key' });
    old.version(2).stores({});
    old.version(3).stores({ practice_logs: 'id, card_id, practiced_at, session_id' });
    old.version(4).stores({});
    await old.open();
    await old.table('import_candidates').bulkAdd([
      { id: 'c1', job_id: 'j1', term: 'bank', selected: false, user_status: 'exists' },
      { id: 'c2', job_id: 'j1', term: 'cope', selected: true, user_status: 'new' },
      { id: 'c3', job_id: 'j1', term: 'sway', selected: false, user_status: 'add_sense' },
    ]);
    old.close();

    const d = new EngDb(name);
    await d.open();
    expect(d.verno).toBe(LATEST);
    const rows = await d.import_candidates.orderBy('id').toArray();
    expect(rows.map((r) => [r.id, r.bucket, r.selected, r.cefr, r.cefr_source, r.from_list])).toEqual([
      ['c1', 'known', false, null, null, false],
      ['c2', 'for_you', true, null, null, false],
      ['c3', 'for_you', false, null, null, false],
    ]);
    expect(await d.outbox.count()).toBe(0);
    d.close();
    await d.delete();
  });

  it('v12 adds anki_imports, keeps review logs as they are and re-pulls sources once', async () => {
    const name = 'upgrade-v12-test';
    // A database as v0.2 left it (version 11).
    const old = new Dexie(name);
    old.version(1).stores({ review_logs: 'id, card_id, reviewed_at, undo_of', sources: 'id, created_at', meta: 'key' });
    old.version(11).stores({ sources: 'id, created_at, *topics' });
    await old.open();
    await old.table('review_logs').add({ id: 'l1', card_id: 'c1', reviewed_at: 1, undo_of: null, rating: 3 });
    await old.table('meta').bulkPut([
      { key: 'sync_cursor', value: 77 },
      { key: PULL_BACKFILL_KEY, value: ['decks'] },
    ]);
    old.close();

    const d = new EngDb(name);
    await d.open();
    expect(d.verno).toBe(LATEST);
    expect(await d.anki_imports.count()).toBe(0);
    // Logs are never rewritten: no origin is filled in (absent = 'app').
    expect(await d.review_logs.get('l1')).toEqual({ id: 'l1', card_id: 'c1', reviewed_at: 1, undo_of: null, rating: 3 });
    expect((await d.meta.get(PULL_BACKFILL_KEY))?.value).toEqual(expect.arrayContaining(['decks', 'sources']));
    expect(await d.outbox.count()).toBe(0);
    d.close();
    await d.delete();
  });

  it('v13 adds the lexicon_pair_notes cache and keeps import jobs and user content as they are', async () => {
    const name = 'upgrade-to-v13';
    // A database as v0.2 left it (version 11), with an import job and an edited sentence.
    const old = new Dexie(name);
    old.version(11).stores({
      import_jobs: 'id, status, created_at',
      user_content: 'id, kind, lexicon_sense_id, replaces_id, deleted_at',
      meta: 'key',
    });
    await old.open();
    await old.table('import_jobs').add({ id: 'j1', status: 'done', created_at: 1, chunk_total: 2, chunk_done: 2 });
    await old.table('user_content').add({ id: 'u1', kind: 'example_sentence', text: 'x', deleted_at: null });
    old.close();

    const d = new EngDb(name);
    await d.open();
    expect(d.verno).toBe(LATEST);
    const job = await d.import_jobs.get('j1');
    expect(job).toMatchObject({ id: 'j1', chunk_done: 2 });
    expect((job as unknown as { chunk_topics?: unknown }).chunk_topics).toBeUndefined();
    expect(await d.user_content.get('u1')).toMatchObject({ kind: 'example_sentence' });
    const idx = d.lexicon_pair_notes.schema.indexes.map((i) => i.name);
    expect(idx).toEqual(expect.arrayContaining(['[sense_id+kind]', 'term_norm']));
    await d.lexicon_pair_notes.add({
      id: 'pn1',
      term_norm: 'reluctant',
      sense_id: 'ls1',
      lang_pair: 'en-tr',
      kind: 'mnemonic_suggestion',
      content_key: 'k',
      content: { type: 'sound', text_tr: 't', why: null },
      curated: false,
      status: 'active',
      updated_at: 1,
    });
    expect(await d.lexicon_pair_notes.where('[sense_id+kind]').equals(['ls1', 'mnemonic_suggestion']).count()).toBe(1);
    // A cache, not synced: nothing waits in the outbox.
    expect(await d.outbox.count()).toBe(0);
    d.close();
    await d.delete();
  });

  it('v14 upgrade (load management) keeps settings as they are and re-pulls them once', async () => {
    const name = 'upgrade-v14-test';
    const old = new Dexie(name);
    old.version(1).stores({ settings: 'id', meta: 'key' });
    old.version(11).stores({});
    await old.open();
    await old.table('settings').add({ id: 'settings', level: 'B1', daily_new_limit: 12 });
    await old.table('meta').put({ key: 'sync_cursor', value: 77 });
    old.close();

    const d = new EngDb(name);
    await d.open();
    expect(d.verno).toBe(LATEST);
    const s = await d.settings.get('settings');
    expect(s).toMatchObject({ daily_new_limit: 12 });
    // Absent means the defaults (20 min, catch-up on, no vacation): nothing is written.
    expect(s && 'vacation' in s).toBe(false);
    expect((await d.meta.get(PULL_BACKFILL_KEY))?.value).toEqual(expect.arrayContaining(['settings']));
    expect(await d.outbox.count()).toBe(0);
    d.close();
    await d.delete();
  });

  it('v15 upgrade keeps the settings and re-pulls them once (fsrs_params_prev / fsrs_opt_at)', async () => {
    const name = 'upgrade-v15-test';
    const old = new Dexie(name);
    old.version(1).stores({ settings: 'id', meta: 'key' });
    old.version(11).stores({});
    await old.open();
    await old.table('settings').add({ id: 'settings', fsrs_params: [1, 2, 3], hlc: 'h1' });
    await old.table('meta').put({ key: 'sync_cursor', value: 77 });
    old.close();

    const d = new EngDb(name);
    await d.open();
    expect(d.verno).toBe(LATEST);
    const row = await d.settings.get('settings');
    expect(row).toMatchObject({ fsrs_params: [1, 2, 3], hlc: 'h1' });
    expect(row?.fsrs_params_prev).toBeUndefined();
    expect((await d.meta.get('sync_cursor'))?.value).toBe(77);
    expect((await d.meta.get(PULL_BACKFILL_KEY))?.value).toEqual(expect.arrayContaining(['settings']));
    expect(await d.outbox.count()).toBe(0);
    d.close();
    await d.delete();
  });

  it('v17 upgrade re-pulls settings once for the reminder setting, only on devices that pulled', async () => {
    for (const [name, cursor, expected] of [
      ['upgrade-v17-synced', 77, ['settings']],
      ['upgrade-v17-fresh', 0, undefined],
    ] as const) {
      const old = new Dexie(name);
      old.version(1).stores({ settings: 'id', meta: 'key' });
      old.version(11).stores({});
      await old.open();
      await old.table('settings').add({ id: 'settings', theme: 'dark' });
      await old.table('meta').put({ key: 'sync_cursor', value: cursor });
      old.close();

      const d = new EngDb(name);
      await d.open();
      expect(d.verno).toBe(LATEST);
      expect((await d.meta.get(PULL_BACKFILL_KEY))?.value).toEqual(expected);
      // The row itself is untouched: no notify key means "off".
      expect(await d.settings.get('settings')).toEqual({ id: 'settings', theme: 'dark' });
      expect(await d.outbox.count()).toBe(0);
      d.close();
      await d.delete();
    }
  });
});
