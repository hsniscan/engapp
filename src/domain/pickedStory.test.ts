// "Kelimelerimle metin oluştur" (decision 0056): the picker's lists, the search and the request.
import { describe, expect, it } from 'vitest';
import { storyRequest } from '../../supabase/functions/_shared/story-contract';
import {
  buildPickedRequest,
  MAX_PICKS,
  MIN_PICKS,
  pickableWords,
  pickSuggestions,
  searchPickable,
  validPick,
} from './pickedStory';
import { CardState, type Card, type Note, type Sense } from './types';

const T = Date.UTC(2026, 10, 2, 9);
const DAY = 86_400_000;

type N = Parameters<typeof pickableWords>[0][number];
type C = Parameters<typeof pickableWords>[1][number];
type S = Parameters<typeof pickableWords>[2][number];

const note = (id: string, term: string, created = T, over: Partial<Note> = {}): N => ({
  id,
  term,
  term_norm: term.toLowerCase(),
  term_type: 'word',
  deleted_at: null,
  created_at: created,
  ...over,
});
const card = (note_id: string, over: Partial<Card> = {}): C => ({
  note_id,
  deleted_at: null,
  suspended: false,
  state: CardState.Review,
  due: T + 10 * DAY,
  lapses: 0,
  difficulty: 4,
  reps: 3,
  card_type: 'recognition',
  ...over,
});
const sense = (note_id: string, meaning_tr: string, over: Partial<Sense> = {}): S => ({
  note_id,
  sense_no: 1,
  meaning_tr,
  meaning_tr_override: null,
  deleted_at: null,
  ...over,
});

describe('pickableWords', () => {
  it('only live counted words with a card and a usable lemma; the first meaning, override first', () => {
    const notes = [
      note('a', 'Borrow'),
      note('b', 'gone', T, { deleted_at: T }),
      note('c', 'no card'),
      note('d', 'take (sth) off'),
      note('e', 'borrow'), // the same lemma twice: once
    ];
    const cards = [card('a'), card('b'), card('d'), card('e')];
    const senses = [
      sense('a', 'ödünç almak', { sense_no: 2 }),
      sense('a', 'borç almak', { sense_no: 1, meaning_tr_override: 'ödünç al' }),
    ];
    const words = pickableWords(notes, cards, senses);
    expect(words.map((w) => [w.lemma, w.meaning])).toEqual([['borrow', 'ödünç al']]);
  });
});

describe('pickSuggestions', () => {
  const notes = [
    note('1', 'decide', T - 5 * DAY),
    note('2', 'journey', T - 1 * DAY),
    note('3', 'nervous', T - 3 * DAY),
    note('4', 'recipe', T - 2 * DAY),
    note('5', 'improve', T),
  ];
  const cards = [
    card('1', { due: T - 2 * DAY }),
    card('2', { due: T + 3600_000 }),
    card('3', { lapses: 3 }),
    card('4', { difficulty: 8 }),
    card('5', { state: CardState.New, reps: 0, due: T - DAY }), // new: never "due"
  ];

  it('due (most overdue first), hard (lapses, then difficulty), recent (newest first)', () => {
    const s = pickSuggestions(notes, cards, [], T + 12 * 3600_000);
    expect(s.due.map((w) => w.lemma)).toEqual(['decide', 'journey']);
    expect(s.hard.map((w) => w.lemma)).toEqual(['nervous', 'recipe']);
    expect(s.recent.map((w) => w.lemma)).toEqual([
      'improve',
      'journey',
      'recipe',
      'nervous',
      'decide',
    ]);
    // Each list is cut to its size.
    expect(pickSuggestions(notes, cards, [], T, 2).recent).toHaveLength(2);
  });
});

describe('searchPickable', () => {
  const words = [
    { note_id: '1', term: 'give up', lemma: 'give up', meaning: 'vazgeçmek' },
    { note_id: '2', term: 'forgive', lemma: 'forgive', meaning: 'affetmek' },
    { note_id: '3', term: 'abandon', lemma: 'abandon', meaning: 'Vazgeçmek, terk etmek' },
  ];
  it('starts-with first, then contains, then the Turkish meaning', () => {
    expect(searchPickable(words, 'giv').map((w) => w.lemma)).toEqual(['give up', 'forgive']);
    expect(searchPickable(words, 'vazgeç').map((w) => w.lemma)).toEqual(['abandon', 'give up']);
    expect(searchPickable(words, '  ')).toEqual([]);
  });
});

describe('buildPickedRequest (privacy)', () => {
  it('carries the dictionary forms, level, difficulty, topics, form and length; nothing else', () => {
    const req = buildPickedRequest(
      [
        { lemma: 'decide', note_id: 'n1', term: 'Decide', meaning: 'karar vermek' } as never,
        { lemma: 'journey' },
        { lemma: 'borrow' },
      ],
      { genre: 'email', length: 'short', difficulty: 'rahat' },
      'A2',
      ['travel'],
    );
    expect(req).toEqual({
      source: 'picked',
      genre: 'email',
      length: 'short',
      level: 'A2',
      difficulty: 'rahat',
      interests: ['travel'],
      target_lemmas: ['decide', 'journey', 'borrow'],
    });
    expect(storyRequest.safeParse(req).success).toBe(true);
  });

  it('3 to 8 words', () => {
    expect([MIN_PICKS, MAX_PICKS]).toEqual([3, 8]);
    expect([2, 3, 8, 9].map(validPick)).toEqual([false, true, true, false]);
  });
});
