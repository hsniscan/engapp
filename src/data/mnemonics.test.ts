// The user's mnemonics on the device: picks, edits, own text and rejections stay in the
// user's synced tables (user_content, content_feedback); the shared suggestions are a
// read-only cache.
import { beforeEach, describe, expect, it } from 'vitest';
import type { MnemonicResponse } from '../../supabase/functions/_shared/mnemonic-contracts';
import { addNoteWithSenses } from './actions';
import { db } from './db';
import { META, setMeta } from './meta';
import {
  chooseMnemonic,
  getCardMnemonic,
  getMnemonicView,
  rejectMnemonic,
  removeMnemonic,
  saveOwnMnemonic,
  storeMnemonicSuggestions,
  undoRejectMnemonic,
} from './mnemonics';
import { ActionError } from './errors';
import { resetDb } from '../test/db';

const T = Date.UTC(2026, 9, 23, 9);
const SOUND = 'Rölantide kalan motor gibi isteksiz: reluctant biri harekete geçmek istemez.';
const STORY = 'Annem beni sabah yürüyüşüne çağırdı, ben reluctant bir şekilde, isteksizce kalktım.';

function response(p: Partial<MnemonicResponse> = {}): MnemonicResponse {
  return {
    prompt_version: 'mnemonic-v1',
    ai_called: true,
    model: 'm',
    sense_id: 'ls-rel',
    suggestions: [
      { id: 'pn-1', sense_id: 'ls-rel', type: 'sound', text_tr: SOUND, why: 'reluctant ile rölanti aynı seslerle başlar.', updated_at: 1 },
      { id: 'pn-2', sense_id: 'ls-rel', type: 'story', text_tr: STORY, why: null, updated_at: 2 },
    ],
    new_ids: ['pn-1', 'pn-2'],
    none: false,
    exhausted: false,
    counts: { generated: 2, dropped: {} },
    usage: null,
    ...p,
  };
}

async function reluctant() {
  const res = await addNoteWithSenses(
    { term: 'reluctant', senses: [{ meaning_tr: 'isteksiz', lexicon_sense_id: 'ls-rel' }, { meaning_tr: 'gönülsüz' }] },
    T,
  );
  return { linked: res.addedSenses[0]!.id, own: res.addedSenses[1]!.id };
}

beforeEach(async () => {
  await resetDb();
  await db.transaction('rw', db.meta, () => setMeta(META.userId, 'user-1'));
});

describe('mnemonics on the device', () => {
  it('caches suggestions and shows them for the sense', async () => {
    const { linked } = await reluctant();
    expect(await getMnemonicView(linked)).toMatchObject({ asked: false, suggestions: [], chosen: null, lexiconSenseId: 'ls-rel' });
    await storeMnemonicSuggestions(response(), 'reluctant');
    const v = await getMnemonicView(linked);
    expect(v?.suggestions.map((s) => [s.id, s.type])).toEqual([
      ['pn-1', 'sound'],
      ['pn-2', 'story'],
    ]);
    expect(v?.asked).toBe(true);
    // The cache is not synced: nothing for the server.
    expect(await db.outbox.where('table').equals('lexicon_pair_notes').count()).toBe(0);
  });

  it('remembers "nothing found" locally and drops the marker when suggestions arrive later', async () => {
    const { linked } = await reluctant();
    await storeMnemonicSuggestions(response({ suggestions: [], new_ids: [], none: true }), 'reluctant');
    expect(await getMnemonicView(linked)).toMatchObject({ asked: true, none: true, suggestions: [] });
    await storeMnemonicSuggestions(response(), 'reluctant');
    expect(await getMnemonicView(linked)).toMatchObject({ none: false });
    expect(await db.lexicon_pair_notes.get('none:ls-rel')).toBeUndefined();
  });

  it('pick, edit, own text and remove write only the user_content row of the sense', async () => {
    const { linked } = await reluctant();
    await storeMnemonicSuggestions(response(), 'reluctant');
    const before = await db.lexicon_pair_notes.toArray();

    await chooseMnemonic(linked, 'pn-1', T + 1);
    expect(await getCardMnemonic(linked)).toBe(SOUND);
    expect((await getMnemonicView(linked))?.chosen).toMatchObject({ fromId: 'pn-1', edited: false });

    await saveOwnMnemonic(linked, '  Rölanti gibi   ağır:  reluctant. ', { fromId: 'pn-1' }, T + 2);
    expect((await getMnemonicView(linked))?.chosen).toMatchObject({ fromId: 'pn-1', edited: true, text: 'Rölanti gibi ağır: reluctant.' });

    await saveOwnMnemonic(linked, 'Benim cümlem: reluctant = isteksiz.', {}, T + 3);
    expect((await getMnemonicView(linked))?.chosen).toMatchObject({ fromId: null, edited: false });

    // One row per sense, synced like the edited example sentences.
    const rows = await db.user_content.where('kind').equals('mnemonic').toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sense_id: linked, lexicon_sense_id: 'ls-rel', selected: true, user_id: 'user-1' });
    const queued = await db.outbox.toArray();
    expect(new Set(queued.map((o) => o.table))).toEqual(new Set(['notes', 'senses', 'cards', 'user_content']));
    // The shared cache is untouched.
    expect(await db.lexicon_pair_notes.toArray()).toEqual(before);

    await removeMnemonic(linked, T + 4);
    expect(await getCardMnemonic(linked)).toBeNull();
    expect((await getMnemonicView(linked))?.chosen).toBeNull();
  });

  it('a sense outside the shared lexicon can still have the user own text', async () => {
    const { own } = await reluctant();
    expect(await getMnemonicView(own)).toMatchObject({ lexiconSenseId: null, suggestions: [] });
    await saveOwnMnemonic(own, 'Gönülsüz giden reluctant olur.', {}, T);
    expect(await getCardMnemonic(own)).toBe('Gönülsüz giden reluctant olur.');
  });

  it('rejects empty and too long text', async () => {
    const { linked } = await reluctant();
    await expect(saveOwnMnemonic(linked, '   ')).rejects.toBeInstanceOf(ActionError);
    await expect(saveOwnMnemonic(linked, 'x'.repeat(301))).rejects.toBeInstanceOf(ActionError);
    await expect(chooseMnemonic(linked, 'pn-none')).rejects.toBeInstanceOf(ActionError);
  });

  it('a rejection hides the suggestion for this user; rejecting the chosen one clears the choice and undo restores it', async () => {
    const { linked } = await reluctant();
    await storeMnemonicSuggestions(response(), 'reluctant');
    await chooseMnemonic(linked, 'pn-1', T);

    const res = await rejectMnemonic(linked, 'pn-1', T + 1);
    expect(res).toEqual({ clearedChoice: true });
    let v = await getMnemonicView(linked);
    expect(v?.suggestions.map((s) => s.id)).toEqual(['pn-2']);
    expect(v?.rejected).toBe(1);
    expect(v?.chosen).toBeNull();
    const fb = await db.content_feedback.toArray();
    expect(fb).toMatchObject([{ target_kind: 'mnemonic', target_id: 'pn-1', verdict: 'reject', deleted_at: null }]);

    await undoRejectMnemonic(linked, 'pn-1', { restoreChoice: true }, T + 2);
    v = await getMnemonicView(linked);
    expect(v?.suggestions.map((s) => s.id)).toEqual(['pn-1', 'pn-2']);
    expect(v?.chosen).toMatchObject({ fromId: 'pn-1' });

    // An edited pick stays when its suggestion is rejected (the text is the user's now).
    await saveOwnMnemonic(linked, 'Kendi halim: reluctant.', { fromId: 'pn-1' }, T + 3);
    expect(await rejectMnemonic(linked, 'pn-1', T + 4)).toEqual({ clearedChoice: false });
    expect(await getCardMnemonic(linked)).toBe('Kendi halim: reluctant.');
  });

  it('choosing a rejected suggestion takes the rejection back', async () => {
    const { linked } = await reluctant();
    await storeMnemonicSuggestions(response(), 'reluctant');
    await rejectMnemonic(linked, 'pn-2', T);
    await chooseMnemonic(linked, 'pn-2', T + 1);
    const v = await getMnemonicView(linked);
    expect(v?.rejected).toBe(0);
    expect(v?.chosen?.fromId).toBe('pn-2');
  });
});
