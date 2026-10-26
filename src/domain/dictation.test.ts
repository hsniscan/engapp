import { describe, expect, it } from 'vitest';
import { dictationSentences, dictationStateOf, planDictationCards, senseCanDictate } from './dictation';
import type { ExampleItem, SenseExamples } from './examples';

const item = (id: string, context: string, extra: Partial<ExampleItem> = {}): ExampleItem => ({
  id,
  context,
  band: 'B1',
  text: `Sentence ${id} with word.`,
  span: [11 + id.length, 15 + id.length],
  tr: 'Cümle.',
  verdict: null,
  editId: null,
  original: `Sentence ${id} with word.`,
  ...extra,
});

const examples = (byContext: Record<string, ExampleItem[]>, contexts = Object.keys(byContext)): SenseExamples => ({
  contexts,
  byContext: new Map(Object.entries(byContext)),
});

describe('dictationSentences', () => {
  it('takes shared sentences of every context in turn, without skipped, edited or span-less ones', () => {
    const ex = examples({
      daily: [item('a', 'daily'), item('b', 'daily', { verdict: 'skip' }), item('c', 'daily')],
      work: [item('d', 'work', { editId: 'u1', text: 'My own text.' }), item('e', 'work', { span: null }), item('f', 'work')],
    });
    expect(dictationSentences(ex).map((s) => s.exampleId)).toEqual(['a', 'f', 'c']);
    expect(dictationSentences(null)).toEqual([]);
  });

  it('knows ready, none and unknown', () => {
    expect(dictationStateOf(0, null)).toBe('unknown');
    expect(dictationStateOf(2, examples({ daily: [item('a', 'daily', { verdict: 'skip' })] }))).toBe('none');
    expect(dictationStateOf(1, examples({ daily: [item('a', 'daily')] }))).toBe('ready');
  });
});

describe('planDictationCards', () => {
  const sense = (id: string, extra = {}) => ({ id, note_id: `n-${id}`, lexicon_sense_id: `lx-${id}`, deleted_at: null, ...extra });
  const card = (id: string, senseId: string, extra = {}) => ({
    id,
    sense_id: senseId,
    card_type: 'dictation' as const,
    deleted_at: null as number | null,
    updated_at: 1,
    ...extra,
  });

  it('creates for ready senses only, never twice, and never for unknown ones', () => {
    const plan = planDictationCards({
      senses: [sense('s1'), sense('s2'), sense('s3'), sense('s4')],
      liveNotes: new Map([
        ['n-s1', 'word'],
        ['n-s2', 'word'],
        ['n-s3', 'word'],
        ['n-s4', 'word'],
      ]),
      cards: [card('c2', 's2')],
      sentences: new Map([
        ['s1', 'ready'],
        ['s2', 'ready'],
        ['s3', 'none'],
      ]),
    });
    expect(plan).toEqual({ create: ['s1'], revive: [], remove: [] });
  });

  it('removes the cards of a deleted sense, a deleted note or a root; revives a card whose note is back', () => {
    const plan = planDictationCards({
      senses: [sense('s1', { deleted_at: 5 }), sense('s2'), sense('s3'), sense('s4')],
      liveNotes: new Map([
        ['n-s1', 'word'],
        ['n-s3', 'affix'],
        ['n-s4', 'phrase'],
      ]),
      cards: [card('c1', 's1'), card('c2', 's2'), card('c3', 's3'), card('c4', 's4', { deleted_at: 3 })],
      sentences: new Map(),
    });
    expect(plan).toEqual({ create: [], revive: ['c4'], remove: ['c1', 'c2', 'c3'] });
  });

  it('a sense needs a lexicon sense and a live, non-root note', () => {
    expect(senseCanDictate({ lexicon_sense_id: 'lx', deleted_at: null }, 'word')).toBe(true);
    expect(senseCanDictate({ lexicon_sense_id: null, deleted_at: null }, 'word')).toBe(false);
    expect(senseCanDictate({ lexicon_sense_id: 'lx', deleted_at: null }, 'contrast')).toBe(false);
    expect(senseCanDictate({ lexicon_sense_id: 'lx', deleted_at: null }, undefined)).toBe(false);
  });
});
