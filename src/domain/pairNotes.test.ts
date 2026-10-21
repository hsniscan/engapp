import md from '../../data/reference/false-friends.en-tr.md?raw';
import { describe, expect, it } from 'vitest';
import { falseFriendKey, falseFriendsFor, indexFalseFriends, parseFalseFriendTable } from './pairNotes';

const HEAD = '| İngilizce | Benzeyen Türkçe | İngilizcesi | Türkçesi | İng. karşılığı | Tür | Not |\n| --- | --- | --- | --- | --- | --- | --- |\n';

describe('parseFalseFriendTable', () => {
  it('reads rows into notes with a stable key', () => {
    const { notes, errors } = parseFalseFriendTable(
      `intro text\n\n${HEAD}| Actually | aktüel | aslında | güncel | current | tam | |\n| sympathy | sempati | başsağlığı | hoşlanma | | kısmi | Dikkat. |\n\nafter`,
    );
    expect(errors).toEqual([]);
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatchObject({
      key: 'actually|aktüel',
      term: 'Actually',
      term_norm: 'actually',
      lang_pair: 'en-tr',
      kind: 'false_friend',
      curated: true,
      content: { tr_word: 'aktüel', en_meaning_tr: 'aslında', tr_meaning_tr: 'güncel', tr_meaning_en: 'current', strength: 'full', note_tr: null },
    });
    expect(notes[1]!.content).toMatchObject({ strength: 'partial', tr_meaning_en: null, note_tr: 'Dikkat.' });
  });

  it('reports bad rows with their line number instead of dropping them silently', () => {
    const { notes, errors } = parseFalseFriendTable(
      `${HEAD}| a | b | c | d | e | belki | |\n| x | | c | d | | tam | |\n| a2 | b | c | d | e | tam |\n| y | İlaç | c | d | | tam | |\n| y | ilaç | c | d | | tam | |`,
    );
    expect(notes.map((n) => n.term)).toEqual(['y']);
    expect(errors).toEqual([
      expect.stringMatching(/^line 3: Tür/),
      expect.stringMatching(/^line 4: .*required/),
      expect.stringMatching(/^line 5: expected 7 columns/),
      expect.stringMatching(/^line 7: duplicate y \/ ilaç/),
    ]);
  });

  it('folds Turkish case in keys', () => {
    expect(falseFriendKey('x', ' İlaç ')).toBe('x|ilaç');
  });
});

describe('the hand-written list (data/reference/false-friends.en-tr.md)', () => {
  const { notes, errors } = parseFalseFriendTable(md);
  const index = indexFalseFriends(notes);

  it('parses without errors and has about 150 pairs', () => {
    expect(errors).toEqual([]);
    expect(notes.length).toBeGreaterThanOrEqual(140);
    for (const n of notes) {
      expect(n.term_norm).toMatch(/^[a-z][a-z' -]*$/);
      expect(n.content.en_meaning_tr.length).toBeGreaterThan(2);
      expect(n.content.tr_meaning_tr.length).toBeGreaterThan(2);
    }
  });

  it('shows the warning for 10 of 10 well-known pairs', () => {
    const pairs: [string, string][] = [
      ['actually', 'aktüel'],
      ['sympathetic', 'sempatik'],
      ['eventually', 'eventüel'],
      ['pasta', 'pasta'],
      ['apartment', 'apartman'],
      ['fabric', 'fabrika'],
      ['smoking', 'smokin'],
      ['jest', 'jest'],
      ['bank', 'bank'],
      ['actual', 'aktüel'],
    ];
    const shown = pairs.filter(([en, tr]) => falseFriendsFor(en, index).some((n) => n.content.tr_word.toLocaleLowerCase('tr') === tr));
    expect(shown.map(([en]) => en)).toEqual(pairs.map(([en]) => en));
  });

  it('hides a dismissed or reported warning and nothing else', () => {
    const [first] = falseFriendsFor('actually', index);
    expect(first).toBeDefined();
    expect(falseFriendsFor('Actually ', index, new Set([first!.key]))).toEqual([]);
    expect(falseFriendsFor('sympathetic', index, new Set([first!.key]))).not.toEqual([]);
    expect(falseFriendsFor('table', index)).toEqual([]);
    expect(falseFriendsFor('', notes)).toEqual([]);
  });
});
