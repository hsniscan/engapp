import { describe, expect, it } from 'vitest';
import {
  handsFreeHref,
  handsFreeSteps,
  NEXT_WORD_PAUSE_MS,
  RECALL_PAUSE_MS,
  revealedAt,
  SHORT_PAUSE_MS,
  type HandsFreeItem,
} from './handsFree';

const item = (sentence: string | null): HandsFreeItem => ({
  cardId: 'c1',
  noteId: 'n1',
  term: 'reluctant',
  meaning: 'isteksiz',
  sentence: sentence ? { text: sentence, tr: null } : null,
});

describe('handsFreeSteps', () => {
  it('English word, a pause to recall, the Turkish meaning, then the sentence', () => {
    expect(handsFreeSteps(item('She was reluctant to leave.'))).toEqual([
      { kind: 'en', text: 'reluctant' },
      { kind: 'pause', ms: RECALL_PAUSE_MS },
      { kind: 'tr', text: 'isteksiz' },
      { kind: 'pause', ms: SHORT_PAUSE_MS },
      { kind: 'sentence', text: 'She was reluctant to leave.' },
      { kind: 'pause', ms: NEXT_WORD_PAUSE_MS },
    ]);
  });

  it('a word without a sentence ends after its meaning', () => {
    expect(handsFreeSteps(item(null)).map((s) => s.kind)).toEqual(['en', 'pause', 'tr', 'pause']);
    expect(handsFreeSteps(item('  ')).map((s) => s.kind)).toEqual(['en', 'pause', 'tr', 'pause']);
  });
});

describe('revealedAt', () => {
  it('shows the meaning from its step on, and the sentence from its step on', () => {
    const steps = handsFreeSteps(item('A sentence.'));
    expect(revealedAt(steps, 0)).toEqual({ meaning: false, sentence: false });
    expect(revealedAt(steps, 1)).toEqual({ meaning: false, sentence: false });
    expect(revealedAt(steps, 2)).toEqual({ meaning: true, sentence: false });
    expect(revealedAt(steps, 4)).toEqual({ meaning: true, sentence: true });
  });
});

describe('handsFreeHref', () => {
  it('is a practice URL in audio mode', () => {
    expect(handsFreeHref('hard', 10)).toBe('/practice?mode=audio&source=hard&size=10');
  });
});
