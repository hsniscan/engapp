// Dictation cards end to end on the database (ADR 0051): which senses get one, the unlock at
// Pekişiyor, FSRS isolation (a dictation answer never changes the word's stage), the queue
// and the card view.
import { beforeEach, describe, expect, it } from 'vitest';
import { dictationCardRowId } from '../domain/dictation';
import { cardStage } from '../domain/stages';
import { CardState, Rating, type Card, type LexiconExample, type RatingValue } from '../domain/types';
import { resetDb } from '../test/db';
import { addNoteWithSenses, answerCard, softDeleteNote, undoAnswer } from './actions';
import { db } from './db';
import { reconcileDictationCards, resetDictationSignature } from './dictation';
import { setContentFeedback } from './examples';
import { getCardView, getStudyQueue } from './queries';
import { updateSettings } from './settings';
import { getWordStages } from './wordStages';

const MIN = 60_000;
const DAY = 86_400_000;
/** 2027-01-11 12:00 Istanbul: after the release, the ramp applies. */
const T = Date.UTC(2027, 0, 11, 9);

function example(id: string, lexSenseId: string, text: string, surface: string, extra: Partial<LexiconExample> = {}): LexiconExample {
  const start = text.indexOf(surface);
  return {
    id,
    sense_id: lexSenseId,
    context: 'daily',
    level_band: 'B1',
    text_en: text,
    span: [start, start + surface.length],
    translations: { tr: 'Türkçesi.' },
    status: 'active',
    updated_at: 1,
    ...extra,
  };
}

beforeEach(async () => {
  await resetDb();
  resetDictationSignature();
  await updateSettings({ timezone: 'Europe/Istanbul', level: 'B1' }, T - 10 * DAY);
});

const cardsOf = (noteId: string): Promise<Card[]> => db.cards.where('note_id').equals(noteId).toArray();

async function addWord(term = 'reluctant', lex: string | null = 'lx-1', at = T) {
  const a = await addNoteWithSenses(
    { term, senses: [{ meaning_tr: 'isteksiz', pos: 'adjective', ...(lex ? { lexicon_sense_id: lex } : {}) }] },
    at,
  );
  const cards = await cardsOf(a.note.id);
  return { noteId: a.note.id, senseId: a.addedSenses[0]!.id, recId: cards.find((c) => c.card_type === 'recognition')!.id };
}

async function answer(cardId: string, rating: RatingValue, at?: number) {
  const card = (await db.cards.get(cardId))!;
  return answerCard({ card_id: cardId, rating, duration_ms: 1000 }, at ?? card.due);
}

/** Recognition answers that take the word to Pekişiyor (ramp_step 1). */
async function toConsolidating(recId: string) {
  await answer(recId, Rating.Good, T + MIN);
  await answer(recId, Rating.Good, T + 12 * MIN);
  return answer(recId, Rating.Good);
}

describe('which senses get a dictation card', () => {
  it('a sense with a cached shared sentence gets one, locked, with a derived id', async () => {
    const { noteId, senseId } = await addWord();
    await db.lexicon_examples.put(example('e1', 'lx-1', 'She was reluctant to leave.', 'reluctant'));
    const plan = await reconcileDictationCards({}, T);
    expect(plan.create).toEqual([senseId]);
    const dictation = (await cardsOf(noteId)).filter((c) => c.card_type === 'dictation');
    expect(dictation).toHaveLength(1);
    expect(dictation[0]!.id).toBe(await dictationCardRowId(senseId));
    expect(dictation[0]!).toMatchObject({ sense_id: senseId, unlocked: false, state: CardState.New, reps: 0 });
    // A second run changes nothing.
    expect((await reconcileDictationCards({ force: true }, T)).create).toEqual([]);
  });

  it('no sentence cached, no lexicon sense, or a root/contrast note: no card', async () => {
    await addWord('hesitant', 'lx-2');
    await addWord('mine', null);
    const root = await addNoteWithSenses({ term: '-spect-', term_type: 'affix', senses: [{ meaning_tr: 'bakmak', lexicon_sense_id: 'lx-3' }] }, T);
    await db.lexicon_examples.put(example('e3', 'lx-3', 'Inspect the spectacle.', 'spect'));
    await reconcileDictationCards({}, T);
    expect(await db.cards.where('card_type').equals('dictation').count()).toBe(0);
    expect(root.note.term_type).toBe('affix');
  });

  it('a sentence the user skipped, edited or that has no span does not count; retired ones neither', async () => {
    const { senseId } = await addWord();
    await db.lexicon_examples.bulkPut([
      example('e1', 'lx-1', 'She was reluctant to leave.', 'reluctant', { status: 'retired' }),
      example('e2', 'lx-1', 'He seemed reluctant.', 'reluctant'),
    ]);
    await setContentFeedback('example', 'e2', 'skip', T);
    expect((await reconcileDictationCards({}, T)).create).toEqual([]);
    await setContentFeedback('example', 'e2', null, T + 1);
    expect((await reconcileDictationCards({}, T + 2)).create).toEqual([senseId]);
  });

  it('a deleted note takes its dictation card along, and the card comes back with the note', async () => {
    const { noteId } = await addWord();
    await db.lexicon_examples.put(example('e1', 'lx-1', 'She was reluctant to leave.', 'reluctant'));
    await reconcileDictationCards({}, T);
    const id = (await cardsOf(noteId)).find((c) => c.card_type === 'dictation')!.id;
    await softDeleteNote(noteId, T + MIN);
    expect((await db.cards.get(id))!.deleted_at).not.toBeNull();
    await reconcileDictationCards({}, T + 2 * MIN);
    expect((await db.cards.get(id))!.deleted_at).not.toBeNull();
  });
});

describe('unlocking (same rule as production and cloze)', () => {
  it('opens when the word reaches Pekişiyor, not at graduation, and closes again on undo', async () => {
    const { noteId, recId } = await addWord();
    await db.lexicon_examples.put(example('e1', 'lx-1', 'She was reluctant to leave.', 'reluctant'));
    await reconcileDictationCards({}, T);
    const dictation = async () => (await cardsOf(noteId)).find((c) => c.card_type === 'dictation')!;

    await answer(recId, Rating.Good, T + MIN);
    const graduated = await answer(recId, Rating.Good, T + 12 * MIN);
    expect(cardStage(graduated.card)).toBe('learning');
    expect((await dictation()).unlocked).toBe(false);

    const nextDay = await answer(recId, Rating.Good);
    expect(cardStage(nextDay.card)).toBe('consolidating');
    expect(nextDay.unlockedCardIds).toContain((await dictation()).id);
    expect((await dictation()).unlocked).toBe(true);

    await undoAnswer(nextDay.log.id, nextDay.log.reviewed_at + MIN);
    expect((await dictation()).unlocked).toBe(false);
  });

  it('a card made after the word is already Pekişiyor starts open', async () => {
    const { noteId, recId } = await addWord();
    await toConsolidating(recId);
    await db.lexicon_examples.put(example('e1', 'lx-1', 'She was reluctant to leave.', 'reluctant'));
    await reconcileDictationCards({}, T + 3 * DAY);
    expect((await cardsOf(noteId)).find((c) => c.card_type === 'dictation')!.unlocked).toBe(true);
  });
});

describe('FSRS isolation', () => {
  it('a dictation answer has its own FSRS card and log, and never changes the word stage', async () => {
    const { noteId, recId } = await addWord();
    await db.lexicon_examples.put(example('e1', 'lx-1', 'She was reluctant to leave.', 'reluctant'));
    await reconcileDictationCards({}, T);
    const nextDay = await toConsolidating(recId);
    const before = (await db.cards.get(recId))!;
    const stagesBefore = await getWordStages(nextDay.log.reviewed_at + MIN);
    const dictationId = (await cardsOf(noteId)).find((c) => c.card_type === 'dictation')!.id;

    // Many answers, from Again to Easy: the recognition card and the stage stay the same.
    let at = nextDay.log.reviewed_at + 2 * MIN;
    for (const r of [Rating.Again, Rating.Good, Rating.Easy, Rating.Easy, Rating.Easy] as RatingValue[]) {
      const res = await answerCard({ card_id: dictationId, rating: r, duration_ms: 1000 }, at);
      expect(res.unlockedCardIds).toEqual([]);
      expect(res.log.card_id).toBe(dictationId);
      at = Math.max(at + MIN, res.card.due);
    }
    const dictation = (await db.cards.get(dictationId))!;
    expect(dictation.reps).toBe(5);
    expect(dictation.state).toBe(CardState.Review);
    expect(await db.cards.get(recId)).toEqual(before);
    expect(cardStage((await db.cards.get(recId))!)).toBe('consolidating');
    // Same stage counts, same "Aktif" (the answers are minutes apart: the week is the same).
    expect(await getWordStages(nextDay.log.reviewed_at + MIN)).toEqual(stagesBefore);
  });
});

describe('queue and card view', () => {
  it('the Dikte queue holds the open card; a card with no usable sentence is left out', async () => {
    const { noteId, recId } = await addWord();
    await db.lexicon_examples.put(example('e1', 'lx-1', 'She was reluctant to leave.', 'reluctant'));
    await reconcileDictationCards({}, T);
    const last = await toConsolidating(recId);
    const now = last.log.reviewed_at + MIN;
    const dictationId = (await cardsOf(noteId)).find((c) => c.card_type === 'dictation')!.id;

    const q = await getStudyQueue({ studyMode: 'dictation', learnAheadMs: 0 }, now + DAY);
    expect(q.items.map((i) => i.card_id)).toEqual([dictationId]);
    // Other modes never show it.
    const word = await getStudyQueue({ studyMode: 'word', learnAheadMs: 0 }, now + DAY);
    expect(word.items.some((i) => i.card_id === dictationId)).toBe(false);

    await setContentFeedback('example', 'e1', 'reject', now);
    const hidden = await getStudyQueue({ studyMode: 'dictation', learnAheadMs: 0 }, now + DAY);
    expect(hidden.items).toEqual([]);
  });

  it('the card view reads a shared sentence with the term as the blank', async () => {
    const { noteId } = await addWord();
    await db.lexicon_examples.bulkPut([
      example('e1', 'lx-1', 'She was reluctant to leave.', 'reluctant'),
      example('e2', 'lx-1', 'They were Reluctant partners.', 'Reluctant', { context: 'work' }),
    ]);
    await reconcileDictationCards({}, T);
    const card = (await cardsOf(noteId)).find((c) => c.card_type === 'dictation')!;
    const view = (await getCardView(card.id, T))!;
    expect(view.sentence).toMatchObject({ text: 'She was reluctant to leave.', exampleId: 'e1' });
    expect(view.cloze).toMatchObject({ before: 'She was ', answer: 'reluctant', after: ' to leave.' });
    // The next showing (after an answer) reads the other sentence.
    await db.cards.put({ ...card, reps: 1 });
    expect((await getCardView(card.id, T))!.sentence?.exampleId).toBe('e2');
  });
});
