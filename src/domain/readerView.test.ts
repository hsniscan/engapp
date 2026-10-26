import { describe, expect, it } from 'vitest';
import { buildKnowledge } from './knowledgeModel';
import { parseClientLevels } from './level';
import { buildReaderView, findPhrases, knownPercent, markOf, phraseIndex } from './readerView';
import { tokenizeReaderText } from './readerTokens';
import type { WordStage } from './stages';

const levels = parseClientLevels(
  ['# @min_zipf 3', 'give\t5.8\tv:A1:j', 'up\t6.3\t', 'walk\t5.1\tv:A1:j', 'dog\t5.0\tn:A1:j', 'cope\t4.1\tv:B1:j', 'quandary\t2.9\tn:C2:o'].join(
    '\n',
  ),
);

function view(body: string, stages: [string, WordStage][] = []) {
  const k = buildKnowledge({
    stages: new Map(stages),
    known: new Set(),
    bandKnown: { A1: 0.98, A2: 0.95, B1: 0.85, B2: 0.5, C1: 0.2, C2: 0.05 },
    levels: { lookup: levels.lookup, minZipf: levels.minZipf },
    offset: 0,
  });
  const text = tokenizeReaderText(body);
  return { text, v: buildReaderView(text, k, stages.map(([t]) => t)) };
}

describe('markOf', () => {
  it('marks by stage, plain once learned, new for a likely unknown word', () => {
    expect(markOf('new', 0, true)).toBe('learning');
    expect(markOf('learning', 0, true)).toBe('learning');
    expect(markOf('consolidating', 1, true)).toBe('consolidating');
    expect(markOf('learned', 1, true)).toBe('plain');
    expect(markOf('mastered', 1, true)).toBe('plain');
    expect(markOf(null, 0.2, true)).toBe('new');
    expect(markOf(null, 0.2, false)).toBe('plain');
    expect(markOf(null, 0.9, true)).toBe('plain');
  });
});

describe('buildReaderView', () => {
  it('colours words, keeps names and numbers plain and collects the met notes', () => {
    const { text, v } = view('The dog walked to Paris. A quandary! I cope 3 times.', [
      ['walk', 'consolidating'],
      ['cope', 'learned'],
    ]);
    const mark = (w: string) => v.marks[text.tokens.findIndex((t) => t.norm === w)];
    expect(mark('walked')).toBe('consolidating');
    expect(mark('cope')).toBe('plain');
    expect(mark('quandary')).toBe('new');
    expect(mark('paris')).toBe('plain');
    expect(mark('3')).toBe('plain');
    expect(mark('dog')).toBe('plain');
    expect(v.metTerms.sort()).toEqual(['cope', 'walk']);
    expect(v.noteTerms[text.tokens.findIndex((t) => t.norm === 'walked')]).toBe('walk');
  });

  it('finds multi-word notes in any form of the first word, inside one sentence', () => {
    const { text, v } = view('She gave up. Give. Up we go.', [['give up', 'learning']]);
    expect(v.phrases).toEqual([{ first: 1, end: 3, term: 'give up' }]);
    expect(v.marks.slice(1, 3)).toEqual(['learning', 'learning']);
    expect(text.tokens[3]!.norm).toBe('give');
    expect(v.noteTerms[3]).toBeNull();
    expect(v.metTerms).toEqual(['give up']);
  });

  it('coverage counts only counted words', () => {
    const { v } = view('A quandary. The dog in Paris in 2024.');
    expect(v.coverage.tokens).toBe(6);
    expect(v.coverage.unknownLemmas).toEqual(['quandary']);
  });
});

describe('phrases', () => {
  it('skips one-word notes and slot patterns, longest first', () => {
    const idx = phraseIndex(['dog', 'take sth for granted', 'give up', 'give up on']);
    expect([...idx.keys()]).toEqual(['give']);
    expect(idx.get('give')).toEqual([
      ['give', 'up', 'on'],
      ['give', 'up'],
    ]);
    const t = tokenizeReaderText('Never give up on it.');
    expect(findPhrases(t.tokens, t.tokens.map((x) => x.norm), idx)).toEqual([{ first: 1, end: 4, term: 'give up on' }]);
    expect(findPhrases(t.tokens, [], new Map())).toEqual([]);
  });
});

describe('knownPercent', () => {
  it('rounds down and handles an empty text', () => {
    expect(knownPercent({ tokens: 100, unknownRate: 0.041, unknownLemmas: [] })).toBe(95);
    expect(knownPercent({ tokens: 100, unknownRate: 0.04, unknownLemmas: [] })).toBe(96);
    expect(knownPercent({ tokens: 0, unknownRate: 0, unknownLemmas: [] })).toBe(100);
  });
});
