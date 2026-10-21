import { describe, expect, it } from 'vitest';
import {
  buildSenseExamples,
  contentRowId,
  exampleState,
  feedbackRowId,
  missingContexts,
  pickRotation,
  rotationSentences,
  selectedContexts,
} from './examples';
import type { ContentFeedback, LexiconExample, UserContent } from './types';

const ex = (p: Partial<LexiconExample> & { id: string; context: string }): LexiconExample => ({
  sense_id: 'ls1',
  level_band: 'B1',
  text_en: 'We had to cope with the delay.',
  span: [10, 14],
  translations: { tr: 'Gecikmeyle başa çıkmak zorunda kaldık.' },
  status: 'active',
  updated_at: 1,
  ...p,
});

const fb = (target_id: string, verdict: ContentFeedback['verdict'], deleted_at: number | null = null): ContentFeedback => ({
  id: `f-${target_id}`,
  user_id: 'u',
  created_at: 1,
  updated_at: 1,
  deleted_at,
  hlc: 'h',
  target_kind: 'example',
  target_id,
  verdict,
});

const edit = (replaces_id: string, text: string): UserContent => ({
  id: `e-${replaces_id}`,
  user_id: 'u',
  created_at: 1,
  updated_at: 1,
  deleted_at: null,
  hlc: 'h',
  kind: 'example_sentence',
  lexicon_sense_id: 'ls1',
  sense_id: null,
  context: 'daily',
  replaces_id,
  text,
  translations: null,
  span: null,
  selected: null,
});

const none = exampleState([], []);

describe('contentRowId', () => {
  it('is a deterministic UUID (version 8) per target', async () => {
    const a = await feedbackRowId('example', 'e1');
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await feedbackRowId('example', 'e1')).toBe(a);
    expect(await feedbackRowId('example', 'e2')).not.toBe(a);
    expect(await contentRowId(['a', 'bc'])).not.toBe(await contentRowId(['ab', 'c']));
  });
});

describe('selectedContexts', () => {
  it('uses the default four without a valid choice', () => {
    expect(selectedContexts({ example_contexts: null })).toEqual(['daily', 'conversation', 'work', 'formal']);
    expect(selectedContexts({ example_contexts: ['travel'] })).toEqual(['daily', 'conversation', 'work', 'formal']);
  });
  it('keeps the user order, drops unknown and duplicate keys, at most four', () => {
    expect(selectedContexts({ example_contexts: ['travel', 'zzz', 'work', 'travel'] })).toEqual(['travel', 'work']);
    expect(selectedContexts({ example_contexts: ['travel', 'work', 'daily', 'health', 'money'] })).toHaveLength(4);
  });
});

describe('buildSenseExamples', () => {
  it('hides rejected sentences, orders liked first and skipped last', () => {
    const rows = [
      ex({ id: 'a', context: 'daily', updated_at: 1 }),
      ex({ id: 'b', context: 'daily', updated_at: 2, text_en: 'Can you cope with two kids?', span: [8, 12] }),
      ex({ id: 'c', context: 'daily', updated_at: 3, text_en: 'She copes well.', span: [4, 9] }),
      ex({ id: 'd', context: 'daily', updated_at: 4, text_en: 'They could not cope.', span: [15, 19] }),
    ];
    const state = exampleState([fb('a', 'skip'), fb('b', 'reject'), fb('d', 'like')], []);
    const out = buildSenseExamples(rows, state, 'B1', ['daily', 'work']);
    expect(out.byContext.get('daily')!.map((i) => i.id)).toEqual(['d', 'c', 'a']);
    expect(out.contexts).toEqual(['daily', 'work']);
  });

  it('a deleted feedback row counts as no verdict', () => {
    const out = buildSenseExamples([ex({ id: 'a', context: 'daily' })], exampleState([fb('a', 'reject', 5)], []), 'B1', ['daily']);
    expect(out.byContext.get('daily')!.map((i) => i.id)).toEqual(['a']);
  });

  it('uses the band closest to the user (ties: the easier one)', () => {
    const rows = [
      ex({ id: 'a2', context: 'work', level_band: 'A2' }),
      ex({ id: 'b2', context: 'work', level_band: 'B2' }),
      ex({ id: 'c1', context: 'daily', level_band: 'C1' }),
    ];
    const out = buildSenseExamples(rows, none, 'B1', ['daily', 'work']);
    expect(out.byContext.get('work')!.map((i) => i.id)).toEqual(['a2']);
    expect(out.byContext.get('daily')!.map((i) => i.id)).toEqual(['c1']);
  });

  it('adds tabs for other contexts that have sentences, in catalogue order', () => {
    const rows = [ex({ id: 'x', context: 'travel' }), ex({ id: 'y', context: 'academic' })];
    expect(buildSenseExamples(rows, none, 'B1', ['daily', 'work']).contexts).toEqual(['daily', 'work', 'academic', 'travel']);
  });

  it('shows the user edit instead of the shared sentence, with its own span and no shared translation', () => {
    const rows = [ex({ id: 'a', context: 'daily' })];
    const state = exampleState([], [edit('a', 'I cannot cope with this noise.')]);
    const [item] = buildSenseExamples(rows, state, 'B1', ['daily']).byContext.get('daily')!;
    expect(item).toMatchObject({ text: 'I cannot cope with this noise.', span: [9, 13], tr: null, editId: 'e-a' });
    expect(item!.original).toBe('We had to cope with the delay.');
  });
});

describe('rotation', () => {
  const sense = { source_sentence: 'I cope.', source_sentence_tr: 'Başa çıkarım.', span: [2, 6] as [number, number] };
  const rows = [
    ex({ id: 'd1', context: 'daily', updated_at: 1 }),
    ex({ id: 'd2', context: 'daily', updated_at: 2, text_en: 'He copes.', span: [3, 8] }),
    ex({ id: 'w1', context: 'work', text_en: 'Staff cope with stress.', span: [6, 10] }),
    ex({ id: 't1', context: 'travel', text_en: 'Travellers cope.', span: [11, 15] }),
  ];

  it('starts with the source sentence and takes contexts in turn, without skipped sentences', () => {
    const examples = buildSenseExamples(rows, exampleState([fb('d2', 'skip')], []), 'B1', ['daily', 'work']);
    const list = rotationSentences(sense, examples, ['daily', 'work'], false);
    expect(list.map((s) => s.exampleId)).toEqual([null, 'd1', 'w1']);
    expect(list[0]!.tr).toBe('Başa çıkarım.');
  });

  it('interleaves rounds: one per context, then the next', () => {
    const examples = buildSenseExamples(rows, none, 'B1', ['daily', 'work']);
    expect(rotationSentences(sense, examples, ['daily', 'work'], false).map((s) => s.exampleId)).toEqual([null, 'd1', 'w1', 'd2']);
  });

  it('cloze keeps only sentences where the term is located', () => {
    const rows2 = [ex({ id: 'd1', context: 'daily' })];
    const state = exampleState([], [edit('d1', 'Totally rewritten sentence.')]);
    const examples = buildSenseExamples(rows2, state, 'B1', ['daily']);
    expect(rotationSentences({ ...sense, span: null }, examples, ['daily'], true)).toEqual([]);
    expect(rotationSentences(sense, examples, ['daily'], false).map((s) => s.text)).toEqual(['I cope.', 'Totally rewritten sentence.']);
  });

  it('pickRotation moves one step per answer', () => {
    expect(pickRotation(['a', 'b', 'c'], 0)).toBe('a');
    expect(pickRotation(['a', 'b', 'c'], 4)).toBe('b');
    expect(pickRotation([], 3)).toBeNull();
  });

  it('missingContexts lists contexts without visible sentences', () => {
    const examples = buildSenseExamples(rows, none, 'B1', ['daily', 'formal']);
    expect(missingContexts(examples, ['daily', 'formal'])).toEqual(['formal']);
    expect(missingContexts(null, ['daily'])).toEqual(['daily']);
  });
});
