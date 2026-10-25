// Level tests, known terms, the weekly update and the counter, on the real Dexie schema.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseClientLevels } from '@/domain/level';
import { LEVELS } from '@/domain/levelTest';
import { Rating, type Card, type CefrLevel, type LevelTestItem } from '@/domain/types';
import { resetDb } from '@/test/db';
import { addNoteWithSenses, answerCard } from './actions';
import { db } from './db';
import { getKnownTermKeys, listKnownTerms, markKnown, unmarkKnown } from './knownTerms';
import { setLevelDataForTests } from './levelData';
import {
  applyTestLevel,
  BAND_SIZES,
  dismissLevelChange,
  getLevelOverview,
  runWeeklyLevelUpdate,
  saveLevelTest,
  undoLevelChange,
} from './levelModel';
import { getSettings, updateSettings } from './settings';

const H = 3_600_000;
const D = 24 * H;
// Monday 2026-10-05 04:00 Istanbul.
const MON = Date.UTC(2026, 9, 5, 1);

/** A small level file: 60 B2 words, a few others. */
function levelFile(): string {
  const lines = ['# @min_zipf 3', 'cope\t4.1\tv:B1:j', 'apple\t4.5\tn:A1:j', 'quokka\t2.0\t'];
  for (let i = 0; i < 60; i++) lines.push(`btwo${i}\t3.5\tn:B2:j`);
  return lines.join('\n');
}

beforeEach(async () => {
  await resetDb();
  setLevelDataForTests(parseClientLevels(levelFile()));
  await updateSettings({ timezone: 'Europe/Istanbul' }, MON - 30 * D);
});
afterEach(() => setLevelDataForTests(null));

const ratios = (r: Partial<Record<CefrLevel, number>>) =>
  Object.fromEntries(LEVELS.map((b) => [b, r[b] ?? 0])) as Record<CefrLevel, number>;

describe('known terms (İP4 API)', () => {
  it('markKnown is idempotent per normalised key; unmarkKnown tombstones and syncs', async () => {
    const a = await markKnown('  Give Up ', 'preview', MON);
    const b = await markKnown('give up', 'manual', MON + 1);
    expect(b.id).toBe(a.id);
    expect(await getKnownTermKeys()).toEqual(new Set(['give up']));
    expect(await markKnown('cope', 'manual', MON)).toMatchObject({ term_norm: 'cope', cefr_at_mark: 'B1' });

    expect(await unmarkKnown('Give up', MON + 2)).toBe(1);
    expect(await getKnownTermKeys()).toEqual(new Set(['cope']));
    const outbox = await db.outbox.where('table').equals('known_terms').toArray();
    expect(outbox.map((o) => o.op)).toContain('delete');

    // Marked again: the same row comes back, no duplicate.
    const c = await markKnown('give up', 'preview', MON + 3);
    expect(c.id).toBe(a.id);
    expect((await listKnownTerms()).map((k) => k.term_norm).sort()).toEqual(['cope', 'give up']);
    await expect(markKnown('   ', 'manual')).rejects.toThrow();
  });
});

describe('saving a level test', () => {
  const items: LevelTestItem[] = [
    { w: 'cope', band: 'B1', pseudo: false, answer: 'yes' },
    { w: 'apple', band: 'A1', pseudo: false, answer: 'yes', mc_ok: false },
    { w: 'btwo1', band: 'B2', pseudo: false, answer: 'no' },
    { w: 'plinder', band: null, pseudo: true, answer: 'no' },
  ];
  const input = {
    items,
    level: 'B2' as const,
    ratios: ratios({ A1: 1, A2: 1, B1: 0.9, B2: 0.82, C1: 0.4, C2: 0.2 }),
    reliable: true,
    falseAlarm: 0,
    vocabEstimate: 5432,
    bankVersion: 'bank-test',
    durationMs: 200_000,
  };

  it('a reliable result sets the level and marks the "Biliyorum" words known', async () => {
    await addNoteWithSenses({ term: 'cope', senses: [{ meaning_tr: 'başa çıkmak' }] }, MON);
    const t = await saveLevelTest(input, MON + H);
    expect(t).toMatchObject({ applied: true, reliable: true, result_level: 'B2', vocab_estimate: 5432 });
    expect(await getSettings()).toMatchObject({ level: 'B2', level_source: 'test', level_updated_at: MON + H });
    // cope has a card; apple failed its meaning question; btwo1 was "no".
    expect(await getKnownTermKeys()).toEqual(new Set());
    expect(await db.outbox.where('table').equals('level_tests').count()).toBe(1);
  });

  it('marks yes-answers of a reliable test as known (source test)', async () => {
    await saveLevelTest({ ...input, items: [{ w: 'btwo2', band: 'B2', pseudo: false, answer: 'yes', mc_ok: true }] }, MON);
    expect((await listKnownTerms())[0]).toMatchObject({ term_norm: 'btwo2', source: 'test', cefr_at_mark: 'B2' });
  });

  it('an unreliable result is kept but changes nothing until the user applies it', async () => {
    await saveLevelTest({ ...input, reliable: false, falseAlarm: 0.5 }, MON);
    expect(await getSettings()).toMatchObject({ level: 'B1', level_source: 'default' });
    expect(await db.level_tests.toArray()).toMatchObject([{ applied: false, reliable: false }]);
    expect(await getKnownTermKeys()).toEqual(new Set());
    await applyTestLevel('B2', MON + 1);
    expect(await getSettings()).toMatchObject({ level: 'B2', level_source: 'test' });
  });

  it('choosing a level by hand is "manual"', async () => {
    await updateSettings({ level: 'C1' }, MON);
    expect(await getSettings()).toMatchObject({ level: 'C1', level_source: 'manual', level_updated_at: MON });
  });
});

/**
 * Learn a word to Öğrenildi (ADR 0041): two learning steps, then recalled 15 days later. The
 * 15-day gap proves ramp level 3 at once, and stability passes 14 days: learned at `at` + 15 d.
 */
async function learnWord(term: string, at: number): Promise<void> {
  const r = await addNoteWithSenses({ term, senses: [{ meaning_tr: 'x' }] }, at);
  const rec = (await db.cards.where('note_id').equals(r.note.id).toArray()).find((c: Card) => c.card_type === 'recognition')!;
  for (const t of [at + 30 * 60_000, at + 45 * 60_000, at + 15 * D]) {
    await answerCard({ card_id: rec.id, rating: Rating.Good, duration_ms: 1000 }, t);
  }
  expect((await db.cards.get(rec.id))!.learned_at).toBe(at + 15 * D);
}

describe('weekly update', () => {
  it('moves B1 → B2 after two weeks of B2 evidence, once per week, with a reason', async () => {
    await saveLevelTest(
      {
        items: [],
        level: 'B1',
        ratios: ratios({ A1: 1, A2: 1, B1: 0.85, B2: 0.5, C1: 0.2, C2: 0.1 }),
        reliable: true,
        falseAlarm: 0,
        vocabEstimate: 4000,
        bankVersion: 'b',
        durationMs: 1,
      },
      MON - 28 * D,
    );
    // Learned at MON − 12 d: evidence at this week's start and at last week's.
    for (let i = 0; i < 40; i++) await learnWord(`btwo${i}`, MON - 27 * D);
    const out = await runWeeklyLevelUpdate(MON + 2 * H);
    expect(out).toMatchObject({ status: 'changed', change: { from: 'B1', to: 'B2', band: 'B2', known: 40 } });
    const s = await getSettings();
    expect(s).toMatchObject({ level: 'B2', level_source: 'auto', level_change: { from: 'B1', to: 'B2', dismissed: false } });
    // Same week again: not even looked at.
    expect(await runWeeklyLevelUpdate(MON + 5 * H)).toBeNull();
    // Forced in the same week: the change of this week blocks a second step.
    expect(await runWeeklyLevelUpdate(MON + 6 * H, true)).toMatchObject({ status: 'too_soon' });

    await dismissLevelChange(MON + 7 * H);
    expect((await getSettings()).level_change?.dismissed).toBe(true);
    await undoLevelChange(MON + 8 * H);
    expect(await getSettings()).toMatchObject({ level: 'B1', level_source: 'manual', level_change: null });
  });

  it('does nothing while the level is locked', async () => {
    for (let i = 0; i < 40; i++) await learnWord(`btwo${i}`, MON - 20 * D);
    await updateSettings({ level_locked: true }, MON - 19 * D);
    expect(await runWeeklyLevelUpdate(MON + H)).toMatchObject({ status: 'locked' });
    expect((await getSettings()).level).toBe('B1');
  });
});

describe('vocabulary counter', () => {
  it('Σ size × ratio plus learned words outside the list; "to next" from the next level', async () => {
    // Before the test: outside the list, but no evidence after the prior.
    await learnWord('quokka', MON - 20 * D);
    await markKnown('zzyzx', 'manual', MON - D);
    await saveLevelTest(
      {
        items: [],
        level: 'B1',
        ratios: ratios({ A1: 1, A2: 0.95, B1: 0.85, B2: 0.5, C1: 0.2, C2: 0.1 }),
        reliable: true,
        falseAlarm: 0,
        vocabEstimate: 0,
        bankVersion: 'b',
        durationMs: 1,
      },
      MON,
    );
    const o = await getLevelOverview(MON + 5 * D);
    expect(o.hasBasis).toBe(true);
    const expected =
      BAND_SIZES.A1 * 1 + BAND_SIZES.A2 * 0.95 + BAND_SIZES.B1 * 0.85 + BAND_SIZES.B2 * 0.5 + BAND_SIZES.C1 * 0.2 + BAND_SIZES.C2 * 0.1 + 2;
    expect(o.vocab.estimate).toBe(Math.round(expected / 10) * 10);
    expect(o.vocab.outside).toBe(2);
    expect(o.vocab.next).toBe('B2');
    expect(o.vocab.toNext).toBe(Math.ceil(Math.ceil((0.8 - 0.5) * BAND_SIZES.B2) / 10) * 10);
  });

  it('has no basis before a test or a chosen level', async () => {
    const o = await getLevelOverview(MON);
    expect(o.hasBasis).toBe(false);
    expect(o.lastTest).toBeNull();
  });
});
