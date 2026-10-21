import { beforeEach, describe, expect, it } from 'vitest';
import { addNoteWithSenses } from './actions';
import { copyCardsFromOtherAccount } from './account';
import { db } from './db';
import {
  dueExampleJobs,
  EXAMPLES_SINCE_KEY,
  finishExampleJobs,
  getExamplePrepStatus,
  getSenseExamples,
  JOB_PRIORITY,
  queueExampleJob,
  reconcileExampleJobs,
  removeExampleEdit,
  saveExampleEdit,
  setExampleVerdict,
  startExampleBackfill,
  storeExamples,
} from './examples';
import { exportBackup, restoreBackup } from './maintenance';
import { META, setMeta } from './meta';
import { getCardView } from './queries';
import { updateSettings } from './settings';
import { backupChecksum } from '../domain/backup';
import type { LexiconExample } from '../domain/types';
import { resetDb } from '../test/db';

const T = Date.UTC(2026, 9, 22, 9);
const DAY = 86_400_000;

const ex = (p: Partial<LexiconExample> & { id: string; context: string }): LexiconExample => ({
  sense_id: 'ls-cope',
  level_band: 'B1',
  text_en: 'We had to cope with the delay.',
  span: [10, 14],
  translations: { tr: 'Gecikmeyle başa çıkmak zorunda kaldık.' },
  status: 'active',
  updated_at: 1,
  ...p,
});

async function cope(now = T) {
  return addNoteWithSenses(
    {
      term: 'cope',
      senses: [
        {
          meaning_tr: 'başa çıkmak',
          lexicon_sense_id: 'ls-cope',
          source_sentence: 'I can cope.',
          source_sentence_tr: 'Başa çıkabilirim.',
          span: [6, 10],
        },
      ],
    },
    now,
  );
}

beforeEach(async () => {
  await resetDb();
  await db.transaction('rw', db.meta, () => setMeta(META.userId, 'user-1'));
});

describe('verdicts', () => {
  it('like / skip / reject are one synced row per sentence; reject hides the sentence', async () => {
    await storeExamples([ex({ id: 'e1', context: 'daily' }), ex({ id: 'e2', context: 'daily', text_en: 'She copes.', span: [4, 9] })]);
    await setExampleVerdict('e1', 'like', T);
    await setExampleVerdict('e1', 'reject', T + 1);
    expect(await db.content_feedback.count()).toBe(1);
    const row = (await db.content_feedback.toArray())[0]!;
    expect(row).toMatchObject({ target_kind: 'example', target_id: 'e1', verdict: 'reject', user_id: 'user-1', deleted_at: null });
    expect(await db.outbox.where('table').equals('content_feedback').count()).toBeGreaterThan(0);

    const view = await getSenseExamples('ls-cope', T);
    expect(view.examples.byContext.get('daily')!.map((i) => i.id)).toEqual(['e2']);

    // Undo (toast) takes the verdict back.
    await setExampleVerdict('e1', null, T + 2);
    expect((await db.content_feedback.toArray())[0]!.deleted_at).toBe(T + 2);
    expect((await getSenseExamples('ls-cope', T)).examples.byContext.get('daily')).toHaveLength(2);
  });
});

describe('edits', () => {
  it('are stored in user_content only and replace the shared text for this user', async () => {
    await storeExamples([ex({ id: 'e1', context: 'work' })]);
    await saveExampleEdit('e1', '  We had to cope   with a late train. ', { senseId: 's1' }, T);
    const [row] = await db.user_content.toArray();
    expect(row).toMatchObject({
      kind: 'example_sentence',
      replaces_id: 'e1',
      lexicon_sense_id: 'ls-cope',
      sense_id: 's1',
      context: 'work',
      text: 'We had to cope with a late train.',
      span: [10, 14],
      translations: null,
      deleted_at: null,
    });
    // The shared cache is untouched and nothing is queued for it.
    expect((await db.lexicon_examples.get('e1'))!.text_en).toBe('We had to cope with the delay.');
    const tables = new Set((await db.outbox.toArray()).map((o) => o.table));
    expect([...tables]).toEqual(['user_content']);

    const [item] = (await getSenseExamples('ls-cope', T)).examples.byContext.get('work')!;
    expect(item).toMatchObject({ text: 'We had to cope with a late train.', editId: row!.id, original: 'We had to cope with the delay.' });

    await removeExampleEdit('e1', T + 1);
    expect((await getSenseExamples('ls-cope', T)).examples.byContext.get('work')![0]!.text).toBe('We had to cope with the delay.');
  });

  it('rejects empty and too long sentences', async () => {
    await storeExamples([ex({ id: 'e1', context: 'work' })]);
    await expect(saveExampleEdit('e1', '   ', {}, T)).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(saveExampleEdit('e1', 'x'.repeat(301), {}, T)).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

describe('cache', () => {
  it('a retired sentence is removed from the cache', async () => {
    await storeExamples([ex({ id: 'e1', context: 'daily' })]);
    await storeExamples([ex({ id: 'e1', context: 'daily', status: 'retired' })]);
    expect(await db.lexicon_examples.count()).toBe(0);
  });
});

describe('getCardView rotation', () => {
  it('the recognition front shows the source sentence, then example sentences in turn', async () => {
    const r = await cope();
    await storeExamples([
      ex({ id: 'e1', context: 'daily' }),
      ex({ id: 'e2', context: 'work', text_en: 'Staff cope with stress.', span: [6, 10] }),
    ]);
    const card = r.createdCards.find((c) => c.card_type === 'recognition')!;
    const at = async (reps: number) => {
      await db.cards.update(card.id, { reps });
      return (await getCardView(card.id, T))!.sentence;
    };
    expect(await at(0)).toMatchObject({ text: 'I can cope.', exampleId: null, tr: 'Başa çıkabilirim.', trOnTap: false });
    expect(await at(1)).toMatchObject({ exampleId: 'e1', trOnTap: true });
    expect(await at(2)).toMatchObject({ exampleId: 'e2' });
    expect(await at(3)).toMatchObject({ exampleId: null });

    await setExampleVerdict('e1', 'skip', T);
    expect(await at(1)).toMatchObject({ exampleId: 'e2' });

    await updateSettings({ example_tr_visible: true }, T);
    expect(await at(1)).toMatchObject({ trOnTap: false });
  });

  it('a cloze card blanks the example sentence it shows', async () => {
    const r = await cope();
    await storeExamples([ex({ id: 'e1', context: 'daily' })]);
    const cloze = r.createdCards.find((c) => c.card_type === 'cloze');
    expect(cloze).toBeDefined();
    await db.cards.update(cloze!.id, { reps: 1 });
    const view = (await getCardView(cloze!.id, T))!;
    expect(view.sentence?.exampleId).toBe('e1');
    expect(view.cloze).toMatchObject({ before: 'We had to ', answer: 'cope', after: ' with the delay.' });
  });
});

describe('preparation queue', () => {
  it('queues senses of new cards; older ones wait for "prepare all"', async () => {
    await cope(T - 30 * DAY);
    await addNoteWithSenses({ term: 'thrive', senses: [{ meaning_tr: 'gelişmek', lexicon_sense_id: 'ls-thrive' }] }, T);
    await addNoteWithSenses({ term: 'manual', senses: [{ meaning_tr: 'el ile' }] }, T);
    expect(await reconcileExampleJobs(T)).toBe(1);
    expect((await dueExampleJobs(T)).map((j) => j.sense_id)).toEqual(['ls-thrive']);
    expect((await dueExampleJobs(T))[0]).toMatchObject({ level_band: 'B1', contexts: ['daily', 'conversation', 'work', 'formal'] });

    await startExampleBackfill(T);
    const due = await dueExampleJobs(T);
    expect(due.map((j) => [j.sense_id, j.priority])).toEqual([
      ['ls-thrive', JOB_PRIORITY.recent],
      ['ls-cope', JOB_PRIORITY.backfill],
    ]);
    expect(await getExamplePrepStatus(T)).toMatchObject({ senses: 2, ready: 0, queued: 2, backfill: true });
  });

  it('asks only for contexts without sentences, and not again after a finished job', async () => {
    await db.transaction('rw', db.meta, () => setMeta(EXAMPLES_SINCE_KEY, 0));
    await cope();
    await storeExamples([ex({ id: 'e1', context: 'daily' }), ex({ id: 'e2', context: 'work' })]);
    await reconcileExampleJobs(T);
    const [job] = await dueExampleJobs(T);
    expect(job!.contexts).toEqual(['conversation', 'formal']);

    // The model had nothing natural for "formal": the job is done, it is not queued again.
    await finishExampleJobs([job!.key], { status: 'done' }, T);
    await storeExamples([ex({ id: 'e3', context: 'conversation' })]);
    expect(await reconcileExampleJobs(T + 1)).toBe(0);
    expect(await getExamplePrepStatus(T)).toMatchObject({ ready: 1 });

    // A newly selected context is asked for.
    await updateSettings({ example_contexts: ['daily', 'travel'] }, T + 2);
    expect(await reconcileExampleJobs(T + 2)).toBe(1);
    expect((await dueExampleJobs(T + 2))[0]!.contexts).toEqual(['travel']);
  });

  it('a sense opened on screen jumps the queue', async () => {
    await db.transaction('rw', db.meta, () => setMeta(EXAMPLES_SINCE_KEY, 0));
    await cope();
    await addNoteWithSenses({ term: 'thrive', senses: [{ meaning_tr: 'gelişmek', lexicon_sense_id: 'ls-thrive' }] }, T + 1);
    await reconcileExampleJobs(T + 2);
    expect((await dueExampleJobs(T + 2)).map((j) => j.sense_id)).toEqual(['ls-cope', 'ls-thrive']);
    await queueExampleJob('ls-thrive', { priority: JOB_PRIORITY.open }, T + 3);
    expect((await dueExampleJobs(T + 3))[0]).toMatchObject({ sense_id: 'ls-thrive', priority: JOB_PRIORITY.open });
  });
});

describe('backups and accounts', () => {
  it('a backup carries feedback and edits; an older backup restored with overwrite keeps them', async () => {
    await cope();
    await storeExamples([ex({ id: 'e1', context: 'daily' })]);
    await setExampleVerdict('e1', 'like', T);
    await saveExampleEdit('e1', 'I had to cope with it.', {}, T);
    const backup = await exportBackup(T);
    expect(backup.tables.content_feedback).toHaveLength(1);
    expect(backup.tables.user_content).toHaveLength(1);

    // The same data as a schema_version 3 file (no content tables, checksum over that shape).
    const { content_feedback: _f, user_content: _u, ...older } = backup.tables;
    const file = { ...backup, schema_version: 3, tables: older, checksum: await backupChecksum(older) };
    await restoreBackup(file, 'overwrite', T + 1);
    expect((await db.content_feedback.toArray()).filter((r) => r.deleted_at === null)).toHaveLength(1);
    expect((await db.user_content.toArray()).filter((r) => r.deleted_at === null)).toHaveLength(1);
  });

  it('copying cards to another account leaves likes, rejections and edits behind (ADR 0009)', async () => {
    await cope();
    await storeExamples([ex({ id: 'e1', context: 'daily' })]);
    await setExampleVerdict('e1', 'reject', T);
    await saveExampleEdit('e1', 'I had to cope with it.', {}, T);
    await copyCardsFromOtherAccount('user-2', { rows: [], nextSeq: 0 }, T + 1);
    expect(await db.content_feedback.count()).toBe(0);
    expect(await db.user_content.count()).toBe(0);
    expect(await db.lexicon_examples.count()).toBe(1); // shared cache stays
    expect(await db.notes.count()).toBe(1);
  });
});
