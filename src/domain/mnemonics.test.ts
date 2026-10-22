import { describe, expect, it } from 'vitest';
import {
  buildMnemonicView,
  cleanMnemonicText,
  MAX_USER_MNEMONIC_CHARS,
  mnemonicRowId,
  mnemonicTextError,
  suggestionOf,
} from './mnemonics';
import { falseFriendKey, falseFriendOfRow, mergeFalseFriends, type FalseFriendNote } from './pairNotes';
import type { ContentFeedback, LexiconPairNote, UserContent } from './types';

const row = (p: Partial<LexiconPairNote> & { id: string }): LexiconPairNote => ({
  term_norm: 'reluctant',
  sense_id: 'ls-1',
  lang_pair: 'en-tr',
  kind: 'mnemonic_suggestion',
  content_key: p.id,
  content: { type: 'sound', text_tr: `Metin ${p.id}: reluctant biri isteksizdir.`, why: 'Sesler benzer.' },
  curated: false,
  status: 'active',
  updated_at: 1,
  ...p,
});

const reject = (targetId: string, deleted: number | null = null): ContentFeedback => ({
  id: `f-${targetId}`,
  user_id: 'u',
  created_at: 1,
  updated_at: 1,
  deleted_at: deleted,
  hlc: 'h',
  target_kind: 'mnemonic',
  target_id: targetId,
  verdict: 'reject',
});

const own = (p: Partial<UserContent>): UserContent => ({
  id: 'own',
  user_id: 'u',
  created_at: 1,
  updated_at: 1,
  deleted_at: null,
  hlc: 'h',
  kind: 'mnemonic',
  lexicon_sense_id: 'ls-1',
  sense_id: 's-1',
  context: null,
  replaces_id: null,
  text: 'Kendi cümlem.',
  translations: null,
  span: null,
  selected: true,
  ...p,
});

describe('mnemonic suggestions', () => {
  it('reads a suggestion row and skips the "nothing found" marker and malformed rows', () => {
    expect(suggestionOf(row({ id: 'a' }))).toEqual({
      id: 'a',
      type: 'sound',
      text: 'Metin a: reluctant biri isteksizdir.',
      why: 'Sesler benzer.',
    });
    expect(suggestionOf(row({ id: 'n', content_key: '-none-', content: { type: 'none' } }))).toBeNull();
    expect(suggestionOf(row({ id: 'b', content: { type: 'joke', text_tr: 'x' } }))).toBeNull();
    expect(suggestionOf(row({ id: 'c', content: { type: 'story', text_tr: '  ' } }))).toBeNull();
    expect(suggestionOf(row({ id: 'd', status: 'retired' }))).toBeNull();
    expect(suggestionOf(row({ id: 'e', kind: 'false_friend' }))).toBeNull();
  });

  it('builds the view: oldest first, rejected ones hidden, chosen and edited', () => {
    const rows = [row({ id: 'b', updated_at: 2 }), row({ id: 'a', updated_at: 1 }), row({ id: 'c', updated_at: 3 })];
    const v = buildMnemonicView(rows, [reject('c'), reject('a', 5)], own({ replaces_id: 'b', text: 'Metin b: reluctant biri isteksizdir.' }));
    expect(v.suggestions.map((s) => s.id)).toEqual(['a', 'b']);
    expect(v.rejected).toBe(1);
    expect(v.asked).toBe(true);
    expect(v.none).toBe(false);
    expect(v.exhausted).toBe(false);
    expect(v.chosen).toMatchObject({ fromId: 'b', edited: false });

    const edited = buildMnemonicView(rows, [], own({ replaces_id: 'b', text: 'Benim halim.' }));
    expect(edited.chosen).toMatchObject({ fromId: 'b', edited: true, text: 'Benim halim.' });
  });

  it('keeps the chosen suggestion visible even when it was rejected on another device', () => {
    const v = buildMnemonicView([row({ id: 'a' })], [reject('a')], own({ replaces_id: 'a', text: 'Metin a: reluctant biri isteksizdir.' }));
    expect(v.suggestions.map((s) => s.id)).toEqual(['a']);
    expect(v.rejected).toBe(0);
  });

  it('says "none" honestly when the sense was asked and nothing good was found', () => {
    const v = buildMnemonicView([row({ id: 'n', content_key: '-none-', content: { type: 'none' } })], [], null);
    expect(v).toMatchObject({ asked: true, none: true, suggestions: [], chosen: null });
    expect(buildMnemonicView([], [], null)).toMatchObject({ asked: false, none: false });
  });

  it('a deleted or empty own row is no choice; own text has no source', () => {
    expect(buildMnemonicView([], [], own({ deleted_at: 3 })).chosen).toBeNull();
    expect(buildMnemonicView([], [], own({})).chosen).toMatchObject({ fromId: null, edited: false });
  });

  it('is exhausted at ten suggestions', () => {
    const rows = Array.from({ length: 10 }, (_, i) => row({ id: `r${i}`, updated_at: i }));
    expect(buildMnemonicView(rows, [], null).exhausted).toBe(true);
  });

  it('checks and cleans the user text', () => {
    expect(cleanMnemonicText(' bir \n iki ')).toBe('bir iki');
    expect(mnemonicTextError('   ')).toBe('empty');
    expect(mnemonicTextError('a'.repeat(MAX_USER_MNEMONIC_CHARS + 1))).toBe('too_long');
    expect(mnemonicTextError('Güzel bir çağrışım.')).toBeNull();
  });

  it('has one deterministic user_content row per sense', async () => {
    expect(await mnemonicRowId('s-1')).toBe(await mnemonicRowId('s-1'));
    expect(await mnemonicRowId('s-1')).not.toBe(await mnemonicRowId('s-2'));
    expect(await mnemonicRowId('s-1')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('false friends found by the model (extract-v5)', () => {
  const ff = (p: Partial<LexiconPairNote> = {}): LexiconPairNote =>
    row({
      id: 'ff1',
      term_norm: 'bank',
      kind: 'false_friend',
      content_key: 'Banka',
      content: {
        tr_word: 'Banka',
        en_meaning_tr: 'nehir kıyısı',
        tr_meaning_tr: 'para kurumu',
        tr_meaning_en: null,
        strength: 'partial',
        note_tr: 'Nehir için kullanılan bank bir banka değildir.',
      },
      ...p,
    });

  it('turns a cached row into a warning with the same key as the hand-written list', () => {
    const n = falseFriendOfRow(ff(), 'bank');
    expect(n).toMatchObject({ key: falseFriendKey('bank', 'banka'), curated: false, content: { tr_word: 'Banka', strength: 'partial' } });
    expect(falseFriendOfRow(ff({ status: 'retired' }), 'bank')).toBeNull();
    expect(falseFriendOfRow(ff({ content: { tr_word: 'Banka' } }), 'bank')).toBeNull();
    expect(falseFriendOfRow(ff({ kind: 'mnemonic_suggestion' }), 'bank')).toBeNull();
  });

  it('the hand-written warning wins for the same Turkish word; each word once', () => {
    const found = falseFriendOfRow(ff(), 'bank')!;
    const curated: FalseFriendNote = { ...found, curated: true, content: { ...found.content, note_tr: 'El yazısı' } };
    expect(mergeFalseFriends([curated], [found, found])).toEqual([curated]);
    expect(mergeFalseFriends([], [found, { ...found }])).toHaveLength(1);
  });
});
