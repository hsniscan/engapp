import { describe, expect, it } from 'vitest';
import {
  invalidQueueIds,
  parseAnswerQueue,
  pickReminderCards,
  ratingValue,
  replayTime,
  type ReminderCardCandidate,
} from './notificationAnswer';
import { CardState, Rating } from './types';

const ID1 = '0192f0a0-0000-7000-8000-000000000001';
const ID2 = '0192f0a0-0000-7000-8000-000000000002';

describe('parseAnswerQueue', () => {
  it('keeps valid items once, oldest first', () => {
    const q = parseAnswerQueue([
      { id: ID2, card_id: 'c2', rating: 'Again', at: 200 },
      { id: ID1, card_id: 'c1', rating: 'Good', at: 100 },
      { id: ID1, card_id: 'c1', rating: 'Good', at: 100 },
    ]);
    expect(q).toEqual([
      { id: ID1, card_id: 'c1', rating: 'Good', at: 100 },
      { id: ID2, card_id: 'c2', rating: 'Again', at: 200 },
    ]);
  });

  it('drops anything malformed and names it for removal', () => {
    const raw = [
      { id: 'not-a-uuid', card_id: 'c', rating: 'Good', at: 1 },
      { id: ID1, card_id: '', rating: 'Good', at: 1 },
      { id: ID2, card_id: 'c', rating: 'Easy', at: 1 },
      { id: '0192f0a0-0000-7000-8000-000000000003', card_id: 'c', rating: 'Good', at: Number.NaN },
      null,
      'x',
    ];
    expect(parseAnswerQueue(raw)).toEqual([]);
    expect(invalidQueueIds(raw)).toEqual([
      'not-a-uuid',
      ID1,
      ID2,
      '0192f0a0-0000-7000-8000-000000000003',
    ]);
    expect(parseAnswerQueue('nope')).toEqual([]);
    expect(parseAnswerQueue(undefined)).toEqual([]);
  });

  it('maps the two buttons to Good and Again', () => {
    expect(ratingValue('Good')).toBe(Rating.Good);
    expect(ratingValue('Again')).toBe(Rating.Again);
  });

  it('never dates an answer in the future', () => {
    expect(replayTime(100, 200)).toBe(100);
    expect(replayTime(300, 200)).toBe(200);
  });
});

describe('pickReminderCards', () => {
  const c = (
    card_id: string,
    due: number,
    state: ReminderCardCandidate['state'] = CardState.Review,
  ): ReminderCardCandidate => ({
    card_id,
    due,
    state,
    term: card_id,
    meaning: `tr ${card_id}`,
  });

  it('asks the most overdue Review card due by then, each card once', () => {
    const cards = [
      c('late', 50),
      c('first', 10),
      c('later', 500),
      c('learning', 1, CardState.Learning),
      c('new', 1, CardState.New),
    ];
    expect(pickReminderCards(cards, [100, 100, 100, 600]).map((x) => x?.card_id ?? null)).toEqual([
      'first',
      'late',
      null,
      'later',
    ]);
  });

  it('skips cards without a term or meaning, and nothing for no reminders', () => {
    expect(pickReminderCards([{ ...c('x', 1), meaning: ' ' }], [10])).toEqual([null]);
    expect(pickReminderCards([c('x', 1)], [])).toEqual([]);
  });
});
