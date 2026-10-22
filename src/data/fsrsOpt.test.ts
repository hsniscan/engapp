import { default_w } from 'ts-fsrs';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetDb } from '../test/db';
import { encodeHlc } from '../domain/hlc';
import { clipToBounds } from '../domain/fsrsOptimizer';
import { createScheduler } from '../domain/fsrs';
import { replayCard } from '../domain/recompute';
import { backupTablesSchema } from '../domain/backup';
import { Rating, type Card, type Settings } from '../domain/types';
import { addNoteWithSenses, answerCard, undoAnswer } from './actions';
import { db } from './db';
import {
  adoptFsrsParams,
  countOptimizerReviews,
  loadOptimizerLogs,
  markFsrsOptRun,
  revertFsrsParams,
} from './fsrsOpt';
import { applyRemoteRows, runIntegrityCheck } from './maintenance';
import { getSettings, updateSettings } from './settings';

const T = Date.UTC(2026, 9, 21, 9);
const DAY = 86_400_000;
const PERSONAL = clipToBounds([...default_w].map((v, i) => (i === 20 ? 0.4 : i === 2 ? 1.1 : v)));
const OTHER = clipToBounds([...default_w].map((v, i) => (i === 20 ? 0.3 : v)));

beforeEach(async () => {
  await resetDb();
  await updateSettings({ timezone: 'Europe/Istanbul' }, T - DAY);
});

async function studied(): Promise<Card> {
  const a = await addNoteWithSenses({ term: 'bank', senses: [{ meaning_tr: 'banka' }] }, T);
  const rec = (await db.cards.where('note_id').equals(a.note.id).toArray()).find(
    (c) => c.card_type === 'recognition',
  )!;
  await answerCard({ card_id: rec.id, rating: Rating.Good, duration_ms: 1 }, T);
  await answerCard({ card_id: rec.id, rating: Rating.Good, duration_ms: 1 }, T + 11 * 60_000);
  await answerCard({ card_id: rec.id, rating: Rating.Good, duration_ms: 1 }, T + 3 * DAY);
  return (await db.cards.get(rec.id))!;
}

describe('optimizer history', () => {
  it('reads only answers that count (undone ones are left out), never changing the logs', async () => {
    const card = await studied();
    const undone = await answerCard(
      { card_id: card.id, rating: Rating.Again, duration_ms: 1 },
      T + 9 * DAY,
    );
    await undoAnswer(undone.log.id, T + 9 * DAY + 1000);
    const before = await db.review_logs.toArray();
    const logs = await loadOptimizerLogs();
    expect(logs).toHaveLength(3);
    expect(logs.map((l) => l.rating)).toEqual([3, 3, 3]);
    expect(await countOptimizerReviews(null)).toEqual({ total: 3, sinceLastRun: 3 });
    expect(await countOptimizerReviews(T + DAY)).toEqual({ total: 3, sinceLastRun: 1 });
    expect(await db.review_logs.toArray()).toEqual(before);
  });
});

describe('adopt and revert', () => {
  it('adopting stores the params, keeps the old ones and replays every card with the new ones', async () => {
    const card = await studied();
    const logsBefore = await db.review_logs.toArray();
    const outbox = await db.outbox.count();
    const changed = await adoptFsrsParams(PERSONAL, T + 4 * DAY);
    expect(changed).toBeGreaterThan(0);
    const s = await getSettings();
    expect(s).toMatchObject({
      fsrs_params: PERSONAL,
      fsrs_params_prev: null,
      fsrs_opt_at: T + 4 * DAY,
    });
    const expected = replayCard(
      createScheduler({ request_retention: 0.9, fsrs_params: PERSONAL }),
      card,
      logsBefore,
    ).fsrs;
    expect(await db.cards.get(card.id)).toMatchObject({
      stability: expected.stability,
      due: expected.due,
    });
    expect((await runIntegrityCheck()).ok).toBe(true);
    // Settings and the changed card are queued for sync; review logs are untouched.
    expect(await db.outbox.count()).toBeGreaterThan(outbox);
    expect(await db.review_logs.toArray()).toEqual(logsBefore);
  });

  it('one tap back: revert restores the previous params (defaults first) and the cards', async () => {
    const card = await studied();
    const defaultState = (await db.cards.get(card.id))!;
    await adoptFsrsParams(PERSONAL, T + 4 * DAY);
    await adoptFsrsParams(OTHER, T + 40 * DAY);
    expect(await getSettings()).toMatchObject({ fsrs_params: OTHER, fsrs_params_prev: PERSONAL });

    await revertFsrsParams(T + 41 * DAY);
    expect(await getSettings()).toMatchObject({
      fsrs_params: PERSONAL,
      fsrs_params_prev: null,
      fsrs_opt_at: T + 40 * DAY,
    });
    await revertFsrsParams(T + 42 * DAY);
    expect((await getSettings()).fsrs_params).toBeNull();
    expect(await db.cards.get(card.id)).toMatchObject({
      stability: defaultState.stability,
      due: defaultState.due,
    });
    expect((await runIntegrityCheck()).ok).toBe(true);
  });

  it('a run that keeps the params only records when it ran', async () => {
    await studied();
    await markFsrsOptRun(T + 5 * DAY);
    expect(await getSettings()).toMatchObject({ fsrs_params: null, fsrs_opt_at: T + 5 * DAY });
  });

  it('rejects params ts-fsrs would not accept', async () => {
    await expect(adoptFsrsParams([1, 2, 3], T)).rejects.toThrow();
    expect((await getSettings()).fsrs_params).toBeNull();
  });
});

describe('sync and backup', () => {
  it('params pulled from another device replay every card here', async () => {
    const card = await studied();
    const logs = await db.review_logs.toArray();
    const local = await getSettings();
    const remote: Settings = {
      ...local,
      fsrs_params: PERSONAL,
      fsrs_params_prev: null,
      fsrs_opt_at: T + 5 * DAY,
      hlc: encodeHlc({ ms: T + 5 * DAY, counter: 0, node: 'remote' }),
    };
    const res = await applyRemoteRows({ settings: [remote] }, T + 5 * DAY);
    expect(res.recomputedCards).toBeGreaterThan(0);
    const expected = replayCard(
      createScheduler({ request_retention: 0.9, fsrs_params: PERSONAL }),
      card,
      logs,
    ).fsrs;
    expect((await db.cards.get(card.id))?.stability).toBe(expected.stability);
    expect(await getSettings()).toMatchObject({ fsrs_opt_at: T + 5 * DAY });
  });

  it('the new settings fields go into backups and older backups without them still parse', async () => {
    await studied();
    await adoptFsrsParams(PERSONAL, T + 4 * DAY);
    await adoptFsrsParams(OTHER, T + 5 * DAY);
    const s = await getSettings();
    const tables = {
      notes: [],
      senses: [],
      cards: [],
      review_logs: [],
      sources: [],
      settings: [s],
    };
    expect(backupTablesSchema.parse(tables).settings[0]).toMatchObject({
      fsrs_params: OTHER,
      fsrs_params_prev: PERSONAL,
      fsrs_opt_at: T + 5 * DAY,
    });
    const { fsrs_params_prev: _p, fsrs_opt_at: _o, ...older } = s;
    expect(
      backupTablesSchema.parse({ ...tables, settings: [older] }).settings[0]?.fsrs_params_prev,
    ).toBeUndefined();
  });
});
