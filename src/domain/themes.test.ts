import { describe, expect, it } from 'vitest';
import {
  acceptedGroups,
  buildThemeBatches,
  keptNotes,
  mergeThemeAnswers,
  type ThemeSourceNote,
} from './themes';

const notes = (n: number): ThemeSourceNote[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `n${i}`,
    term: `word${i}`,
    gloss_en: i % 2 ? `gloss ${i}` : null,
  }));

describe('theme batches', () => {
  it('splits into batches with refs w1..wN and nothing but term and gloss', () => {
    const batches = buildThemeBatches(notes(450));
    expect(batches.map((b) => b.words.length)).toEqual([200, 200, 50]);
    expect(batches[1]!.words[0]).toEqual({ ref: 'w1', lemma: 'word200', gloss_en: null });
    expect(batches[1]!.refs.get('w2')).toBe('n201');
    for (const b of batches)
      for (const w of b.words) expect(Object.keys(w).sort()).toEqual(['gloss_en', 'lemma', 'ref']);
  });

  it('caps the length of terms and glosses', () => {
    const [b] = buildThemeBatches([{ id: 'x', term: 'a'.repeat(100), gloss_en: 'b'.repeat(300) }]);
    expect(b!.words[0]!.lemma).toHaveLength(80);
    expect(b!.words[0]!.gloss_en).toHaveLength(200);
  });
});

describe('mergeThemeAnswers', () => {
  it('maps refs back, joins same-named groups across batches, drops tiny groups', () => {
    const batches = buildThemeBatches(notes(6), 3);
    const groups = mergeThemeAnswers(batches, [
      {
        groups: [
          { name_tr: 'Yemek', refs: ['w1', 'w2'] },
          { name_tr: 'Spor', refs: ['w3', 'w9'] },
        ],
      },
      {
        groups: [
          { name_tr: 'yemek', refs: ['w1', 'w1'] },
          { name_tr: ' ', refs: ['w2', 'w3'] },
        ],
      },
    ]);
    expect(groups).toEqual([
      {
        key: 'yemek',
        suggested: 'Yemek',
        name: 'Yemek',
        note_ids: ['n0', 'n1', 'n3'],
        removed: [],
        rejected: false,
      },
    ]);
  });

  it('puts a note in at most one group', () => {
    const batches = buildThemeBatches(notes(4));
    const groups = mergeThemeAnswers(batches, [
      {
        groups: [
          { name_tr: 'A', refs: ['w1', 'w2'] },
          { name_tr: 'B', refs: ['w2', 'w3', 'w4'] },
        ],
      },
    ]);
    expect(groups.map((g) => [g.name, g.note_ids])).toEqual([
      ['A', ['n0', 'n1']],
      ['B', ['n2', 'n3']],
    ]);
  });
});

describe('accepted groups', () => {
  const g = (p: object) => ({
    key: 'k',
    suggested: 'K',
    name: 'K',
    note_ids: ['a', 'b', 'c'],
    removed: [] as string[],
    rejected: false,
    ...p,
  });

  it('skips rejected, emptied and unnamed groups and notes deleted meanwhile', () => {
    expect(keptNotes(g({ removed: ['b'] }))).toEqual(['a', 'c']);
    expect(
      acceptedGroups(
        [
          g({ name: ' #Mutfak ' }),
          g({ rejected: true }),
          g({ removed: ['a', 'b', 'c'] }),
          g({ name: '  ' }),
        ],
        new Set(['a', 'b']),
      ),
    ).toEqual([{ name: 'Mutfak', noteIds: ['a', 'b'] }]);
  });
});
