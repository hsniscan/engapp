// "Kelimelerimi temalara ayır" on the local database: what is sent, and approving a preview.
import { beforeEach, describe, expect, it } from 'vitest';
import { buildThemeBatches, MAX_THEME_RUN_WORDS } from '../domain/themes';
import { LIMITS } from '../domain/limits';
import { resetDb } from '../test/db';
import { addNoteWithSenses, softDeleteNote } from './actions';
import { db } from './db';
import {
  applyThemePreview,
  discardThemePreview,
  getThemePreview,
  getThemeSource,
  saveThemePreview,
  updateThemePreview,
} from './themes';

const T = Date.UTC(2026, 9, 21, 9);

beforeEach(resetDb);

async function word(
  term: string,
  opts: { tags?: string[]; gloss?: string; lex?: string; at?: number } = {},
) {
  const r = await addNoteWithSenses(
    {
      term,
      tags: opts.tags ?? [],
      senses: [
        {
          meaning_tr: `${term} özel anlam`,
          gloss_en: opts.gloss ?? null,
          lexicon_sense_id: opts.lex ?? null,
          source_sentence: `My private sentence with ${term}.`,
        },
      ],
    },
    opts.at ?? T,
  );
  return r.note.id;
}

describe('theme source', () => {
  it('sends untagged words newest first with an English gloss and nothing else', async () => {
    await db.lexicon_cache.put({
      id: 'lex-1',
      term_id: 't',
      lemma: 'bank',
      lemma_norm: 'bank',
      term_type: 'word',
      pos: 'noun',
      gloss_en: 'a financial institution',
      meaning_tr: 'banka',
      ipa: null,
      updated_at: T,
    });
    const a = await word('bank', { lex: 'lex-1', at: T - 2 });
    const b = await word('river', { gloss: 'a large stream', at: T - 1 });
    await word('desk', { tags: ['iş'], at: T });
    const c = await word('plain', { at: T + 1 });

    const src = await getThemeSource();
    expect(src.total).toBe(3);
    expect(src.notes).toEqual([
      { id: c, term: 'plain', gloss_en: null },
      { id: b, term: 'river', gloss_en: 'a large stream' },
      { id: a, term: 'bank', gloss_en: 'a financial institution' },
    ]);
    expect((await getThemeSource({ includeTagged: true })).total).toBe(4);

    // What actually goes over the wire: refs, terms, glosses. No ids, meanings or sentences.
    const wire = JSON.stringify(buildThemeBatches(src.notes).map((x) => x.words));
    for (const secret of [a, b, c, 'özel', 'private', 'iş']) expect(wire).not.toContain(secret);
  });

  it(`caps a run at ${MAX_THEME_RUN_WORDS} words`, async () => {
    await db.notes.bulkPut(
      Array.from({ length: MAX_THEME_RUN_WORDS + 5 }, (_, i) => ({
        id: `n${i}`,
        term: `w${i}`,
        term_norm: `w${i}`,
        term_type: 'word' as const,
        ipa: null,
        tags: [],
        lexicon_term_id: null,
        created_at: T + i,
        updated_at: T + i,
        deleted_at: null,
        hlc: '0',
      })) as never,
    );
    const src = await getThemeSource();
    expect(src.total).toBe(MAX_THEME_RUN_WORDS + 5);
    expect(src.notes).toHaveLength(MAX_THEME_RUN_WORDS);
  });
});

describe('theme preview', () => {
  it('approving turns kept groups into tags in one go and clears the preview', async () => {
    const [a, b, c, d] = [
      await word('apple'),
      await word('bread'),
      await word('car', { tags: ['Yemek'] }),
      await word('bus'),
    ];
    await saveThemePreview({
      created_at: T,
      model: 'm',
      sent: 4,
      groups: [
        {
          key: 'yemek',
          suggested: 'Yemek',
          name: 'Yemek',
          note_ids: [a, b, c],
          removed: [],
          rejected: false,
        },
        {
          key: 'ulaşım',
          suggested: 'Ulaşım',
          name: 'Ulaşım',
          note_ids: [c, d],
          removed: [],
          rejected: false,
        },
        { key: 'x', suggested: 'X', name: 'X', note_ids: [a, d], removed: [], rejected: false },
      ],
    });
    // The user renames one group, removes a word from another and rejects the third.
    await updateThemePreview((p) => ({
      ...p,
      groups: p.groups.map((g) =>
        g.key === 'yemek'
          ? { ...g, name: 'Mutfak' }
          : g.key === 'ulaşım'
            ? { ...g, removed: [c] }
            : { ...g, rejected: true },
      ),
    }));
    await softDeleteNote(b, T + 1);
    await db.outbox.clear();

    const r = await applyThemePreview(T + 2);
    expect(r).toEqual({ tags: ['Mutfak', 'Ulaşım'], notes: 3, full: 0 });
    expect((await db.notes.bulkGet([a, b, c, d])).map((n) => n!.tags)).toEqual([
      ['Mutfak'],
      [],
      ['Yemek', 'Mutfak'],
      ['Ulaşım'],
    ]);
    expect(await db.outbox.count()).toBe(3);
    expect(await getThemePreview()).toBeNull();
  });

  it('reports notes that are full and can be discarded without writing anything', async () => {
    const full = Array.from({ length: LIMITS.tags }, (_, i) => `t${i}`);
    const a = await word('a', { tags: full });
    const b = await word('b');
    await saveThemePreview({
      created_at: T,
      model: 'm',
      sent: 2,
      groups: [
        { key: 'k', suggested: 'K', name: 'K', note_ids: [a, b], removed: [], rejected: false },
      ],
    });
    await db.outbox.clear();
    await discardThemePreview();
    expect(await applyThemePreview(T)).toEqual({ tags: [], notes: 0, full: 0 });
    expect(await db.outbox.count()).toBe(0);

    await saveThemePreview({
      created_at: T,
      model: 'm',
      sent: 2,
      groups: [
        { key: 'k', suggested: 'K', name: 'K', note_ids: [a, b], removed: [], rejected: false },
      ],
    });
    expect(await applyThemePreview(T)).toEqual({ tags: ['K'], notes: 1, full: 1 });
  });
});
