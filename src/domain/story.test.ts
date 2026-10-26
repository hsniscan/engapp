import { describe, expect, it } from 'vitest';
import { STORY_DIFFICULTIES } from '../../supabase/functions/_shared/story-contract';
import { GOOD_STORY } from '../../supabase/functions/_shared/testing/story-fixtures';
import { validateStoryOutput } from '../../supabase/functions/_shared/story';
import { makeCard } from '@/test/factories';
import { tokenizeReaderText } from './readerTokens';
import {
  selectStoryTargets,
  storyAvoidList,
  storyBody,
  storyCoverage,
  storyEncounterNotes,
  storyInfo,
  storyLemmaOf,
  storyLimit,
  STORY_TARGET_COUNT,
} from './story';
import { READING_DIFFICULTIES } from './texts';
import { CardState, type Note } from './types';
import type { Knowledge } from './knowledgeModel';

const DAY = 24 * 3600_000;
const NOW = Date.UTC(2026, 10, 2, 9);
const END = Date.UTC(2026, 10, 2, 21);

type N = Pick<Note, 'id' | 'term_norm' | 'term_type' | 'deleted_at'>;
const note = (id: string, term: string, extra: Partial<N> = {}): N => ({
  id,
  term_norm: term,
  term_type: 'word',
  deleted_at: null,
  ...extra,
});
/** A recognition card in review, due at `due`. */
const review = (noteId: string, due: number, extra: Parameters<typeof makeCard>[0] | object = {}) =>
  makeCard({
    note_id: noteId,
    state: CardState.Review,
    due,
    stability: 20,
    ramp_step: 3,
    last_review: NOW - 10 * DAY,
    ...extra,
  });

describe('selectStoryTargets', () => {
  it('due words first (most overdue first), then words learned this week', () => {
    const notes = [
      note('n1', 'decide'),
      note('n2', 'journey'),
      note('n3', 'borrow'),
      note('n4', 'nervous'),
      note('n5', 'recipe'),
      note('n6', 'improve'),
      note('n7', 'harbour'),
    ];
    const cards = [
      review('n1', NOW - 2 * DAY),
      review('n2', NOW - 5 * DAY),
      review('n3', END - 1000), // due later today
      // Being learned, studied yesterday and the day before: "recent".
      review('n4', NOW + 3 * DAY, { state: CardState.Learning, ramp_step: 0, last_review: NOW - DAY }),
      review('n5', NOW + 3 * DAY, { ramp_step: 1, stability: 3, last_review: NOW - 2 * DAY }),
      // Learned long ago and not due: not picked.
      review('n6', NOW + 30 * DAY),
      // Being learned but last studied a month ago: not "newly learned".
      review('n7', NOW + 3 * DAY, { ramp_step: 1, stability: 3, last_review: NOW - 30 * DAY }),
    ];
    const t = selectStoryTargets(notes, cards, NOW, END);
    expect(t.map((x) => [x.lemma, x.reason])).toEqual([
      ['journey', 'due'],
      ['decide', 'due'],
      ['borrow', 'due'],
      ['nervous', 'recent'],
      ['recipe', 'recent'],
    ]);
  });

  it('leaves out new, suspended, deleted, slot patterns, affixes and long phrases', () => {
    const notes = [
      note('a', 'fresh'), // never answered
      note('b', 'paused'),
      note('c', 'gone', { deleted_at: NOW - DAY }),
      note('d', 'take sth for granted', { term_type: 'pattern' }),
      note('e', 'un-', { term_type: 'affix' as Note['term_type'] }),
      note('f', 'once in a blue moon', { term_type: 'phrase' }),
      note('g', 'give up', { term_type: 'phrase' }),
    ];
    const cards = [
      makeCard({ note_id: 'a', due: NOW - DAY }),
      review('b', NOW - DAY, { suspended: true }),
      review('c', NOW - DAY),
      review('d', NOW - DAY),
      review('e', NOW - DAY),
      review('f', NOW - DAY),
      review('g', NOW - DAY),
    ];
    expect(selectStoryTargets(notes, cards, NOW, END).map((x) => x.lemma)).toEqual(['give up']);
  });

  it(`takes at most ${STORY_TARGET_COUNT}`, () => {
    const notes = Array.from({ length: 12 }, (_, i) => note(`n${i}`, `word${'abcdefghijkl'[i]}`));
    const cards = notes.map((n, i) => review(n.id, NOW - i * 1000));
    expect(selectStoryTargets(notes, cards, NOW, END)).toHaveLength(STORY_TARGET_COUNT);
  });

  it('storyLemmaOf accepts what the server accepts', () => {
    expect(storyLemmaOf('give up')).toBe('give up');
    expect(storyLemmaOf("o'clock")).toBe("o'clock");
    expect(storyLemmaOf('café')).toBeNull();
    expect(storyLemmaOf('make up one’s mind')).toBeNull();
  });
});

describe('coverage of a story', () => {
  const body = storyBody(GOOD_STORY);
  const text = tokenizeReaderText(body);
  // Knows everything except "flat", "okafor" (a name is not counted) and the target words.
  const hard = new Set(['flat', 'wonderful', 'decide', 'journey', 'borrow', 'nervous', 'recipe', 'improve']);
  const k: Knowledge = {
    lemmatize: (w) =>
      ({ decided: 'decide', borrowed: 'borrow', felt: 'feel', fallen: 'fall' })[w] ?? w,
    pKnown: (l) => (hard.has(l) ? 0 : 1),
  };

  it('target words do not count against the difficulty', () => {
    const withTargets = storyCoverage(text, k, []);
    const without = storyCoverage(text, k, GOOD_STORY.used_words);
    expect(without.unknownRate).toBeLessThan(withTargets.unknownRate);
    expect(without.unknownLemmas.sort()).toEqual(['flat', 'wonderful']);
  });

  it('the limit is the band’s top, never over 10 %', () => {
    expect(storyLimit('rahat')).toBe(0.03);
    expect(storyLimit('dengeli')).toBe(0.05);
    expect(storyLimit('zorlayici')).toBe(0.1);
  });

  it('the avoid list holds the hardest words the server accepts', () => {
    expect(storyAvoidList({ tokens: 100, unknownRate: 0.2, unknownLemmas: ['flat', 'naïve', 'x'] })).toEqual([
      'flat',
    ]);
  });

  it('keeps the questions, glosses and only the glossed hard words when over the limit', () => {
    const v = validateStoryOutput(GOOD_STORY, GOOD_STORY.used_words);
    if (typeof v === 'string') throw new Error(v);
    const candidates = GOOD_STORY.used_words.map((lemma, i) => ({
      note_id: `n${i}`,
      lemma,
      reason: 'due' as const,
    }));
    const cov = { tokens: 160, unknownRate: 0.06125, unknownLemmas: ['neighbour', 'flat'] };
    const info = storyInfo(v, candidates, '2026-11-02', 'story-v1', cov, true);
    expect(info.targets[2]).toEqual({ note_id: 'n2', lemma: 'borrow', used: true, gloss_tr: 'ödünç almak' });
    expect(info.questions).toHaveLength(3);
    expect(info.glossed).toEqual([{ lemma: 'neighbour', gloss_tr: 'komşu' }]);
    expect(info.unknown_rate).toBe(0.0613);
    expect(storyInfo(v, candidates, '2026-11-02', 'story-v1', cov, false).glossed).toEqual([]);
    expect(storyEncounterNotes(info)).toEqual(['n0', 'n1', 'n2', 'n3', 'n4', 'n5']);
  });
});

describe('contract', () => {
  it('the server knows the same difficulties as the app', () => {
    expect([...STORY_DIFFICULTIES]).toEqual([...READING_DIFFICULTIES]);
  });
});
