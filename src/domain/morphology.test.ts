import { describe, expect, it } from 'vitest';
import { morphologyFile } from '@/test/morphology';
import { MORPHOLOGY_ASSET } from '@/features/family/morphologyAsset';
import {
  cardedMorphemes,
  familyOf,
  indexMorphology,
  MIN_WORDS_FOR_MORPHEME_CARD,
  morphemeMeaning,
  morphemeOfNote,
  morphemeSuggestions,
  wordInfo,
  type MorphemeEntry,
  type UserWord,
} from './morphology';

// The committed data file, exactly as the app fetches it.
const file = morphologyFile;
const index = indexMorphology(file);
const uw = (...terms: string[]): UserWord[] => terms.map((t) => ({ term: t, term_norm: t }));

describe('the built morphology file', () => {
  it('matches the generated asset record', () => {
    expect(file.format).toBe(1);
    expect(file.license).toBe('CC BY-SA 4.0');
    expect(file.words).toHaveLength(MORPHOLOGY_ASSET.words);
    expect(file.families).toHaveLength(MORPHOLOGY_ASSET.families);
    expect(file.morphemes).toHaveLength(MORPHOLOGY_ASSET.morphemes);
  });

  it('shows a family for at least 25 of the 30-word test set', () => {
    // Plan İP6 "Bitti ölçütü": decide, construct, inspect, actually, sympathetic, …
    const set = [
      'decide', 'construct', 'inspect', 'actually', 'sympathetic', 'respect', 'nation', 'create', 'develop', 'educate',
      'connect', 'organize', 'compete', 'produce', 'describe', 'inform', 'govern', 'employ', 'depend', 'protect',
      'attract', 'predict', 'legal', 'possible', 'happy', 'care', 'use', 'agree', 'act', 'visit',
    ];
    expect(set).toHaveLength(30);
    const withFamily = set.filter((w) => familyOf(index, w, new Set()) !== null);
    expect(withFamily.length).toBeGreaterThanOrEqual(25);
    expect(familyOf(index, 'decide', new Set())?.members.map((m) => m.lemma)).toEqual(
      expect.arrayContaining(['decide', 'decision', 'decisive', 'undecided']),
    );
  });

  it('has a Turkish meaning for every morpheme and keeps unrelated words out of roots', () => {
    for (const m of file.morphemes) expect(morphemeMeaning(m).meaning.trim()).not.toBe('');
    const ids = (w: string) => wordInfo(index, w)?.morphemes.map((m) => m.id) ?? [];
    expect(ids('inspect')).toContain('spect');
    expect(ids('respect')).toContain('spect');
    expect(ids('special')).not.toContain('spect');
    expect(ids('miss')).not.toContain('mit');
  });
});

describe('lookups', () => {
  it('finds the lemma of a plain inflection', () => {
    expect(wordInfo(index, 'Decisions')?.lemma).toBe('decision');
    expect(wordInfo(index, 'inspected')?.lemma).toBe('inspect');
    expect(wordInfo(index, 'give up')).toBeNull();
    expect(wordInfo(index, 'zzzz')).toBeNull();
  });

  it('marks the term itself and the words the user has', () => {
    const fam = familyOf(index, 'inspect', new Set(['inspection']))!;
    expect(fam.base).toBe('inspect');
    expect(fam.members.find((m) => m.lemma === 'inspect')).toMatchObject({ carded: true, self: true });
    expect(fam.members.find((m) => m.lemma === 'inspection')).toMatchObject({ carded: true, self: false });
    expect(fam.members.find((m) => m.lemma === 'inspector')).toMatchObject({ carded: false, self: false });
  });

  it('finds the morpheme of an affix note by its form or id', () => {
    const spect = morphemeOfNote(index, '-spect-');
    expect(spect?.id).toBe('spect');
    expect(morphemeOfNote(index, 'spect')?.id).toBe('spect');
    expect(morphemeOfNote(index, 're-')?.kind).toBe('prefix');
    expect(cardedMorphemes(index, ['-spect-', 'nothing'])).toEqual(new Set(['spect']));
  });
});

describe('morphemeMeaning', () => {
  const base: MorphemeEntry = { id: 'x', form: '-x-', kind: 'root', origin: 'latin', gloss_en: 'x', tr: 'elle', words: 3, ai: null };
  it('prefers the AI explanation and falls back to the hand-written meaning', () => {
    expect(morphemeMeaning(base)).toEqual({ meaning: 'elle', note: null, source: 'curated' });
    const ai = { meaning_tr: 'yapay', note_tr: 'not', model: 'm', prompt_version: 'morpheme-tr-v1', reviewed: false };
    expect(morphemeMeaning({ ...base, ai })).toEqual({ meaning: 'yapay', note: 'not', source: 'ai' });
    expect(morphemeMeaning({ ...base, ai: { ...ai, meaning_tr: ' ' } }).source).toBe('curated');
  });
});

describe('root/affix card suggestion', () => {
  const none = { carded: new Set<string>(), dismissed: new Set<string>() };

  it(`needs at least ${MIN_WORDS_FOR_MORPHEME_CARD} of the user's words with the same root`, () => {
    expect(morphemeSuggestions(index, 'inspect', uw('inspect', 'respect'), none)).toEqual([]);
    const s = morphemeSuggestions(index, 'inspect', uw('inspect', 'respect', 'spectator', 'table'), none);
    expect(s[0]?.morpheme.id).toBe('spect');
    expect(s[0]?.words.map((w) => w.term)).toEqual(['inspect', 'respect', 'spectator']);
  });

  it('counts inflected spellings and different family members alike', () => {
    const s = morphemeSuggestions(index, 'respectful', uw('inspected', 'respectful', 'perspective'), none);
    expect(s.map((x) => x.morpheme.id)).toContain('spect');
  });

  it('skips a morpheme the user already has a card for or closed', () => {
    const words = uw('inspect', 'respect', 'spectator');
    expect(morphemeSuggestions(index, 'inspect', words, { carded: new Set(['spect']), dismissed: new Set() })).toEqual([]);
    expect(morphemeSuggestions(index, 'inspect', words, { carded: new Set(), dismissed: new Set(['spect']) })).toEqual([]);
  });

  it('puts roots before affixes', () => {
    const words = uw('inspection', 'construction', 'production', 'introduction', 'reduction');
    const s = morphemeSuggestions(index, 'production', words, none);
    const kinds = s.map((x) => x.morpheme.kind);
    expect(kinds[0]).toBe('root');
    expect(kinds).toEqual([...kinds].sort((a, b) => ['root', 'prefix', 'suffix'].indexOf(a) - ['root', 'prefix', 'suffix'].indexOf(b)));
  });

  it('suggests nothing for a word the file does not know', () => {
    expect(morphemeSuggestions(index, 'qwerty', uw('a', 'b', 'c'), none)).toEqual([]);
  });
});
