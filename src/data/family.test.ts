import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MorphemeEntry } from '../domain/morphology';
import { resetDb } from '../test/db';
import { addNoteWithSenses, editNote, editSense } from './actions';
import { db } from './db';
import {
  addMorphemeCard,
  clearPairNoteFeedback,
  dismissMorphemeSuggestion,
  getDismissedMorphemes,
  getHiddenPairNotes,
  getUserWordSets,
  loadRefFile,
  setPairNoteFeedback,
  pairNoteFeedbackIds,
  pairNoteTargetId,
  FALSE_FRIEND_TARGET,
} from './family';

const T = Date.UTC(2026, 9, 21, 9);
const spect: MorphemeEntry = {
  id: 'spect',
  form: '-spect-',
  kind: 'root',
  origin: 'latin',
  gloss_en: 'look, see',
  tr: 'bakmak, görmek',
  words: 40,
  ai: { meaning_tr: 'bakmak, gözlemek', note_tr: 'inspect = içine bakmak', model: 'm', prompt_version: 'morpheme-tr-v1', reviewed: false },
};

beforeEach(resetDb);

describe('loadRefFile', () => {
  const asset = { url: '/data/x.json', sha256: 'aaa' };
  const ok = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body)));

  it('fetches once, then serves the cached copy offline', async () => {
    const fetcher = ok({ v: 1 });
    expect(await loadRefFile('x', asset, fetcher, T)).toEqual({ v: 1 });
    const offline = vi.fn(async (): Promise<Response> => {
      throw new TypeError('offline');
    });
    expect(await loadRefFile('x', asset, offline, T)).toEqual({ v: 1 });
    expect(offline).not.toHaveBeenCalled();
    expect(await db.ref_cache.get('x')).toMatchObject({ sha256: 'aaa', fetched_at: T });
  });

  it('replaces the copy when the build changes and keeps the old one while it cannot', async () => {
    await loadRefFile('x', asset, ok({ v: 1 }), T);
    const next = { url: '/data/y.json', sha256: 'bbb' };
    const failing = vi.fn(async () => new Response('no', { status: 503 }));
    expect(await loadRefFile('x', next, failing, T)).toEqual({ v: 1 });
    expect(await loadRefFile('x', next, ok({ v: 2 }), T)).toEqual({ v: 2 });
    expect((await db.ref_cache.get('x'))?.sha256).toBe('bbb');
  });

  it('fails when there is neither a copy nor a network', async () => {
    await expect(loadRefFile('x', asset, vi.fn(async () => new Response('', { status: 404 })), T)).rejects.toThrow(/404/);
  });
});

describe('root/affix cards', () => {
  it('creates a recognition-only affix note with the Turkish meaning', async () => {
    const r = await addMorphemeCard(spect, T);
    expect(r.note).toMatchObject({ term: '-spect-', term_norm: '-spect-', term_type: 'affix' });
    expect(r.addedSenses[0]).toMatchObject({ meaning_tr: 'bakmak, gözlemek', gloss_en: 'look, see', pos: 'root' });
    expect(r.createdCards.map((c) => c.card_type)).toEqual(['recognition']);
    expect(await db.cards.count()).toBe(1);
  });

  it('never gets production or cloze cards, even with a sentence', async () => {
    const r = await addMorphemeCard(spect, T);
    const sense = r.addedSenses[0]!;
    await editSense(sense.id, { source_sentence: 'They inspect the spectacle.', span: [5, 12] }, T + 1);
    const more = await addNoteWithSenses({ term: '-spect-', senses: [{ meaning_tr: 'izlemek' }] }, T + 2);
    expect(more.createdCards).toEqual([]);
    expect((await db.cards.toArray()).map((c) => c.card_type)).toEqual(['recognition']);
  });

  it('removes production cards when a note becomes an affix note and restores them after', async () => {
    const r = await addNoteWithSenses({ term: 'spect', senses: [{ meaning_tr: 'bakmak' }] }, T);
    const live = async () => (await db.cards.toArray()).filter((c) => c.deleted_at === null).map((c) => c.card_type).sort();
    expect(await live()).toEqual(['production', 'recognition']);
    await editNote(r.note.id, { term_type: 'affix' }, T + 1);
    expect(await live()).toEqual(['recognition']);
    await editNote(r.note.id, { term_type: 'word' }, T + 2);
    expect(await live()).toEqual(['production', 'recognition']);
  });

  it('lists word notes and affix notes apart', async () => {
    await addNoteWithSenses({ term: 'inspect', senses: [{ meaning_tr: 'denetlemek' }] }, T);
    await addMorphemeCard(spect, T + 1);
    const old = await addNoteWithSenses({ term: 'respect', senses: [{ meaning_tr: 'saygı' }] }, T + 2);
    await db.notes.update(old.note.id, { deleted_at: T + 3 });
    const sets = await getUserWordSets();
    expect(sets.words).toEqual([{ term: 'inspect', term_norm: 'inspect' }]);
    expect(sets.affixTerms).toEqual(['-spect-']);
    expect(sets.terms).toEqual(new Set(['inspect', '-spect-']));
  });

  it('remembers a closed suggestion once', async () => {
    await dismissMorphemeSuggestion('spect');
    await dismissMorphemeSuggestion('spect');
    expect(await getDismissedMorphemes()).toEqual(new Set(['spect']));
  });
});

describe('false-friend feedback', () => {
  it('hides dismissed and reported warnings, and undo shows them again', async () => {
    const ids = await pairNoteFeedbackIds(['actually|aktüel', 'jest|jest', 'table|tablo']);
    await setPairNoteFeedback('actually|aktüel', 'dismissed', T);
    await setPairNoteFeedback('jest|jest', 'reported', T);
    expect(await getHiddenPairNotes(ids)).toEqual(new Set(['actually|aktüel', 'jest|jest']));
    // One synced content_feedback row per warning: skip = hidden, reject = reported as wrong.
    const rows = await db.content_feedback.toArray();
    expect(rows.map((r) => [r.target_kind, r.target_id, r.verdict]).sort()).toEqual(
      [
        [FALSE_FRIEND_TARGET, await pairNoteTargetId('actually|aktüel'), 'skip'],
        [FALSE_FRIEND_TARGET, await pairNoteTargetId('jest|jest'), 'reject'],
      ].sort(),
    );
    expect(await db.outbox.where('table').equals('content_feedback').count()).toBe(2);
    await clearPairNoteFeedback('actually|aktüel', T + 1);
    expect(await getHiddenPairNotes(ids)).toEqual(new Set(['jest|jest']));
    // Undo is a tombstone (synced), not a local delete.
    expect((await db.content_feedback.toArray()).filter((r) => r.deleted_at === T + 1)).toHaveLength(1);
  });
});
