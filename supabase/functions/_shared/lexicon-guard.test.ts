// @vitest-environment node
// The shared lexicon is visible to every user: text from one user (an imported chunk,
// a typed term or sentence) must not be able to make the model write junk into it.
import { describe, expect, it, vi } from 'vitest';
import type { AiProvider } from './ai-provider.ts';
import { runEnrich } from './enrich.ts';
import { validateExtractOutput } from './extract.ts';
import { MemoryAiStore } from './testing/memory-store.ts';
import { CHUNK, GOOD_EXTRACT } from './testing/gemini-fixtures.ts';
import { isCleanLexiconText } from './text.ts';

const SENT = 'On Sunday she sat on the bank of the river and watched the boats drift by.';

function cand(over: Record<string, unknown>) {
  return {
    term: 'bank',
    surface: 'bank',
    term_type: 'word',
    source_sentence: SENT,
    confidence: 0.9,
    known_sense: null,
    pos: 'noun',
    gloss_en: 'the land beside a river',
    meaning_tr: 'kıyı',
    ipa: null,
    ...over,
  };
}

describe('lexicon guard: ai-extract', () => {
  it('drops a candidate whose term does not occur in the text (surface is another word)', () => {
    const v = validateExtractOutput(
      { candidates: [cand({ term: 'cat', surface: 'river', gloss_en: 'a small pet', meaning_tr: 'köpek' })] },
      CHUNK,
      new Map(),
    );
    expect(v.candidates).toEqual([]);
    expect(v.dropped).toEqual({ term_not_in_text: 1 });
  });

  it('drops new senses with links, markup or non-Latin script in the gloss or meaning', () => {
    const bad = [
      cand({ meaning_tr: 'kıyı, www.spam.example' }),
      cand({ gloss_en: 'visit https://spam.example for the land beside a river' }),
      cand({ gloss_en: 'the <b>land</b> beside a river' }),
      cand({ meaning_tr: 'берег' }),
      cand({ gloss_en: 'mail me@spam.example' }),
    ];
    for (const c of bad) {
      const v = validateExtractOutput({ candidates: [c] }, CHUNK, new Map());
      expect(v.candidates, JSON.stringify(c)).toEqual([]);
      expect(v.dropped).toEqual({ unsafe_text: 1 });
    }
  });

  it('keeps the legitimate fixture candidates', () => {
    const v = validateExtractOutput(GOOD_EXTRACT, CHUNK, new Map());
    expect(v.candidates.map((c) => c.term)).toEqual(['give up', 'bank', 'turn down']);
  });
});

describe('lexicon guard: ai-enrich', () => {
  it('does not store senses with unsafe text', async () => {
    const store = new MemoryAiStore();
    const provider: AiProvider = {
      name: 'fake',
      generateJson: vi.fn(async () => ({
        data: {
          valid: true,
          lemma: 'bank',
          term_type: 'word',
          senses: [
            { pos: 'noun', gloss_en: 'see http://spam.example', meaning_tr: 'banka' },
            { pos: 'noun', gloss_en: 'an organisation that keeps money', meaning_tr: 'banka' },
          ],
          sentence_known_sense: null,
        },
        model: 'fake-model',
        attempts: 1,
        usage: null,
      })),
    };
    const res = await runEnrich({ term: 'bank' }, { userId: 'u', store, provider: () => provider, dailyLimit: 5 });
    expect(res.senses.map((s) => s.gloss_en)).toEqual(['an organisation that keeps money']);
    expect(store.senses.size).toBe(1);
  });
});

describe('isCleanLexiconText', () => {
  it('accepts ordinary English glosses and Turkish meanings', () => {
    expect(isCleanLexiconText("to stop doing sth (a habit); e.g. smoking", 'en')).toBe(true);
    expect(isCleanLexiconText('vazgeçmek, bırakmak (alışkanlık)', 'tr')).toBe(true);
    expect(isCleanLexiconText('ışığı söndürmek / İğne', 'tr')).toBe(true);
  });
});

describe('termMatchesSurface', () => {
  it('accepts inflections, separable phrasal verbs and patterns; refuses unrelated words', async () => {
    const { termMatchesSurface } = await import('./extract.ts');
    const ok: [string, string][] = [
      ['give up', 'gave up'],
      ['turn down', 'turned her application down'],
      ['be used to doing sth', 'is used to working'],
      ['make up one\'s mind', 'made up her mind'],
      ['run into', 'ran into'],
      ['child', 'children'],
      ['as well as', 'as well as'],
    ];
    for (const [t, s] of ok) expect(termMatchesSurface(t, s), `${t} / ${s}`).toBe(true);
    const bad: [string, string][] = [
      ['cat', 'river'],
      ['the cat', 'the'],
      ['buy cheap pills', 'bank'],
    ];
    for (const [t, s] of bad) expect(termMatchesSurface(t, s), `${t} / ${s}`).toBe(false);
  });
});
