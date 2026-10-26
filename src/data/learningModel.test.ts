// The learning model end to end on the database (ADR 0041): unlocking at Pekişiyor, the home
// count, the one-off backfill and the counting-rule notice.
import { beforeEach, describe, expect, it } from 'vitest';
import { RAMP_EPOCH } from '../domain/fsrsConfig';
import { cardStage } from '../domain/stages';
import { CardState, Rating, type Card, type RatingValue } from '../domain/types';
import { resetDb } from '../test/db';
import { addNoteWithSenses, answerCard, undoAnswer } from './actions';
import { db, STAGE_RULE_NOTICE_KEY } from './db';
import { markKnown } from './knownTerms';
import {
  backfillLearningModel,
  LEARNING_MODEL_BACKFILL_KEY,
  markStageRuleNoticeSeen,
  recomputeAllCards,
  stageRuleNoticePending,
} from './maintenance';
import { getMeta, setMeta } from './meta';
import { getStreakSummary } from './queries';
import { updateSettings } from './settings';
import { getWordStages } from './wordStages';

const MIN = 60_000;
const DAY = 86_400_000;
/** 2027-01-11 12:00 Istanbul: after the release, the ramp applies. */
const T = Date.UTC(2027, 0, 11, 9);
const sentence = 'We walked along the river bank at dusk.';

beforeEach(async () => {
  await resetDb();
  await updateSettings({ timezone: 'Europe/Istanbul' }, T - 10 * DAY);
});

const cardsOf = (noteId: string): Promise<Card[]> => db.cards.where('note_id').equals(noteId).toArray();

async function addWord(term = 'bank', at = T) {
  const a = await addNoteWithSenses({ term, senses: [{ meaning_tr: 'kıyı', source_sentence: sentence.replace('bank', term), span: [26, 26 + term.length] }] }, at);
  const rec = (await cardsOf(a.note.id)).find((c) => c.card_type === 'recognition')!;
  return { noteId: a.note.id, recId: rec.id };
}

/** Answer the card when it is due (or at `at`), return the answer. */
async function answer(cardId: string, rating: RatingValue, at?: number) {
  const card = (await db.cards.get(cardId))!;
  return answerCard({ card_id: cardId, rating, duration_ms: 1000 }, at ?? card.due);
}

describe('unlock at Pekişiyor (spec 4)', () => {
  it('production and cloze open when the word is recalled on another day, not at graduation', async () => {
    const { noteId, recId } = await addWord();
    await answer(recId, Rating.Good, T + MIN);
    const graduated = await answer(recId, Rating.Good, T + 12 * MIN);
    expect(graduated.card.state).toBe(CardState.Review);
    expect(graduated.card.due - (T + 12 * MIN)).toBe(DAY); // GRAD_CAP: "yarın"
    expect(graduated.unlockedCardIds).toEqual([]);
    expect((await cardsOf(noteId)).filter((c) => c.unlocked).map((c) => c.card_type)).toEqual(['recognition']);

    const nextDay = await answer(recId, Rating.Good);
    expect(nextDay.card.ramp_step).toBe(1);
    expect(cardStage(nextDay.card)).toBe('consolidating');
    expect(nextDay.unlockedCardIds).toHaveLength(2);
    expect((await cardsOf(noteId)).every((c) => c.unlocked)).toBe(true);

    // Undo of that answer closes them again (they have no history of their own).
    await undoAnswer(nextDay.log.id, nextDay.log.reviewed_at + MIN);
    expect((await cardsOf(noteId)).filter((c) => c.unlocked).map((c) => c.card_type)).toEqual(['recognition']);
  });

  it('Easy on a new word graduates for 3 days and still waits for the next recall', async () => {
    const { noteId, recId } = await addWord();
    const easy = await answer(recId, Rating.Easy, T + MIN);
    expect(easy.card.state).toBe(CardState.Review);
    expect(easy.card.due - (T + MIN)).toBe(3 * DAY);
    expect(easy.unlockedCardIds).toEqual([]);
    const later = await answer(recId, Rating.Good);
    expect(later.unlockedCardIds.length).toBeGreaterThan(0);
    expect((await cardsOf(noteId)).every((c) => c.unlocked)).toBe(true);
  });
});

describe('home count and word stages', () => {
  it('counts words whose recognition card is Öğrenildi; production and "Biliyorum" never count', async () => {
    const { recId } = await addWord('bank');
    const other = await addWord('river');
    await markKnown('house', 'test', T);
    await markKnown('table', 'preview', T);
    // bank: Good ×5 on time → Öğrenildi (1, 3, 7 days apart, S ≥ 14).
    await answer(recId, Rating.Good, T + MIN);
    await answer(recId, Rating.Good, T + 12 * MIN);
    for (let i = 0; i < 3; i++) await answer(recId, Rating.Good);
    const rec = (await db.cards.get(recId))!;
    expect(rec.ramp_step).toBe(3);
    expect(cardStage(rec)).toBe('learned');
    expect(rec.learned_at).toBe(rec.last_review);
    // river: only its production card is studied (made to look learned).
    const prod = (await cardsOf(other.noteId)).find((c) => c.card_type === 'production')!;
    await db.cards.put({ ...prod, unlocked: true, state: CardState.Review, ramp_step: 4, stability: 60, reps: 6 });

    const now = rec.last_review! + MIN;
    const stages = await getWordStages(now);
    expect(stages).toMatchObject({ learned: 1, learnedTotal: 1, weekDelta: 1, active: 1, alreadyKnown: 2, new: 1 });
    expect((await getStreakSummary(now)).learnedCards).toBe(1);
  });
});

describe('backfill after the upgrade (spec 6)', () => {
  it('fills ramp_step and learned_at from the logs once, without moving any due date', async () => {
    // A word studied with the old app: every answer before RAMP_EPOCH.
    const start = RAMP_EPOCH - 120 * DAY;
    await updateSettings({ timezone: 'Europe/Istanbul' }, start - DAY);
    const { recId } = await addWord('bank', start);
    await answer(recId, Rating.Good, start + MIN);
    await answer(recId, Rating.Good, start + 12 * MIN);
    for (let i = 0; i < 3; i++) await answer(recId, Rating.Good);
    const studied = (await db.cards.get(recId))!;
    // Old intervals: 2 d, 11 d, 46 d.
    expect(studied.scheduled_days).toBeGreaterThan(30);
    // What an upgraded device has before the backfill: the v26 defaults.
    await db.cards.put({ ...studied, ramp_step: 0, learned_at: null });
    expect(cardStage((await db.cards.get(recId))!)).toBe('learning');

    expect(await backfillLearningModel(T)).toBeGreaterThan(0);
    const after = (await db.cards.get(recId))!;
    expect(after.due).toBe(studied.due);
    expect(after.stability).toBe(studied.stability);
    expect(after.ramp_step).toBe(studied.ramp_step);
    expect(after.ramp_step).toBe(4);
    expect(after.learned_at).not.toBeNull();
    expect(cardStage(after)).toBe('learned');
    expect(await getMeta(LEARNING_MODEL_BACKFILL_KEY)).toBe(true);
    // Once per device.
    await db.cards.put({ ...after, ramp_step: 0 });
    expect(await backfillLearningModel(T + DAY)).toBe(0);
  });

  it('keeps production/cloze cards the old rule opened (graduated before the release)', async () => {
    const start = RAMP_EPOCH - 3 * DAY;
    const { noteId, recId } = await addWord('bank', start);
    await answer(recId, Rating.Good, start + MIN);
    const grad = await answer(recId, Rating.Good, start + 12 * MIN);
    expect(grad.card.ramp_step).toBe(0);
    expect(grad.unlockedCardIds).toHaveLength(2);
    await recomputeAllCards(T);
    expect((await cardsOf(noteId)).every((c) => c.unlocked)).toBe(true);
  });

  it('shows the counting-rule note once on upgraded devices', async () => {
    expect(await stageRuleNoticePending()).toBe(false);
    await setMeta(STAGE_RULE_NOTICE_KEY, false);
    expect(await stageRuleNoticePending()).toBe(true);
    await markStageRuleNoticeSeen();
    expect(await stageRuleNoticePending()).toBe(false);
  });
});
