import { beforeEach, describe, expect, it } from 'vitest';
import { guessMapping, planAnkiImport, type AnkiCollection, type AnkiMappings } from '../domain/anki';
import { fsrsEqual, pickFsrs } from '../domain/fsrs';
import { replayCard } from '../domain/recompute';
import { CardState } from '../domain/types';
import { readApkg } from '../features/anki/readApkg';
import { buildApkg, largeDeck, sampleDeck } from '../features/anki/testing/buildApkg';
import { nodeLibs } from '../features/anki/testing/nodeLibs';
import { resetDb } from '../test/db';
import { addNoteWithSenses, getLastUndoableAnswer } from './actions';
import {
  applyAnkiEnrichResult,
  getAnkiImport,
  importAnkiPlan,
  nextAnkiEnrichItems,
  nextAnkiEnrichWake,
  pauseAnkiEnrich,
  startAnkiEnrich,
} from './anki';
import { db } from './db';
import { runIntegrityCheck } from './maintenance';
import { getSettings, schedulerFor } from './settings';

const NOW = Date.UTC(2026, 9, 22, 12);

const mappingsOf = (col: AnkiCollection): AnkiMappings => Object.fromEntries(col.noteTypes.map((nt) => [nt.id, guessMapping(nt)]));

async function readSample(format: 'anki2' | 'anki21' | 'anki21b' = 'anki21b'): Promise<AnkiCollection> {
  const libs = await nodeLibs();
  return readApkg(await buildApkg(sampleDeck(), format, libs), libs);
}

async function importCol(col: AnkiCollection, fileName = 'english.apkg', chunkNotes?: number) {
  return importAnkiPlan(planAnkiImport(col, mappingsOf(col), NOW), fileName, chunkNotes ? { chunkNotes } : {}, NOW);
}

/** Every card equals the replay of its logs (invariant 3). */
async function expectCardsMatchLogs(): Promise<void> {
  const scheduler = schedulerFor(await getSettings(NOW));
  const logs = await db.review_logs.toArray();
  for (const card of await db.cards.toArray()) {
    const { fsrs } = replayCard(scheduler, card, logs);
    expect(fsrsEqual(fsrs, pickFsrs(card)), `card ${card.id}`).toBe(true);
  }
}

beforeEach(resetDb);

describe('importAnkiPlan', () => {
  it.each(['anki2', 'anki21', 'anki21b'] as const)('imports the %s sample with its history', async (format) => {
    const { counts, source_id } = await importCol(await readSample(format));
    expect(counts).toMatchObject({ notes: 7, created: 5, sensesAdded: 0, alreadyHad: 0, cardsMapped: 11, logs: 16, suspended: 2, media: 2, skippedNoteType: 1 });

    const notes = await db.notes.toArray();
    expect(notes.map((n) => n.term).sort()).toEqual(['apple', 'bank', 'give up', 'reluctant', 'thorough']);
    expect((await db.senses.count())).toBe(6);
    // reluctant: rec + prod + cloze; give up 2; apple 2; bank: rec + 2 × (prod + cloze); thorough 2.
    expect(await db.cards.count()).toBe(3 + 2 + 2 + 5 + 2);
    const logs = await db.review_logs.toArray();
    expect(logs).toHaveLength(16);
    expect(logs.every((l) => l.origin === 'anki' && l.undo_of === null)).toBe(true);
    await expectCardsMatchLogs();
    expect((await runIntegrityCheck()).ok).toBe(true);

    const source = await db.sources.get(source_id);
    expect(source).toMatchObject({ kind: 'anki', title: 'english', file_name: 'english.apkg' });
    expect((await db.senses.toArray()).every((s) => s.source_id === source_id)).toBe(true);

    const reluctant = notes.find((n) => n.term === 'reluctant')!;
    expect(reluctant.tags).toEqual(['adjectives', 'b2']);
    const cards = await db.cards.where('note_id').equals(reluctant.id).toArray();
    const rec = cards.find((c) => c.card_type === 'recognition')!;
    expect(rec.state).toBe(CardState.Review);
    expect(rec.reps).toBe(6);
    expect(rec.lapses).toBe(1);
    // Production has its own history: unlocked; cloze (no history) unlocks with recognition.
    expect(cards.every((c) => c.unlocked)).toBe(true);

    const apple = notes.find((n) => n.term === 'apple')!;
    expect((await db.cards.where('note_id').equals(apple.id).toArray()).every((c) => c.suspended)).toBe(true);
    const thorough = notes.find((n) => n.term === 'thorough')!;
    const fresh = await db.cards.where('note_id').equals(thorough.id).toArray();
    expect(fresh.map((c) => [c.card_type, c.state, c.unlocked]).sort()).toEqual([
      ['production', CardState.New, false],
      ['recognition', CardState.New, true],
    ]);

    // Synced like any change: every row in the outbox.
    const outbox = await db.outbox.toArray();
    expect(outbox.filter((o) => o.table === 'review_logs')).toHaveLength(16);
    expect(outbox.filter((o) => o.table === 'cards')).toHaveLength(14);
    // The history fills daily_activity (heatmap, streak).
    expect(await db.daily_activity.count()).toBeGreaterThan(5);
  });

  it('creates nothing when the same file is imported again', async () => {
    const col = await readSample();
    const first = await importCol(col);
    const before = { notes: await db.notes.count(), senses: await db.senses.count(), cards: await db.cards.count(), logs: await db.review_logs.count(), sources: await db.sources.count() };
    const second = await importCol(col);
    expect(second.source_id).toBe(first.source_id);
    expect(second.counts).toMatchObject({ created: 0, sensesAdded: 0, alreadyHad: 5, logs: 0 });
    expect({ notes: await db.notes.count(), senses: await db.senses.count(), cards: await db.cards.count(), logs: await db.review_logs.count(), sources: await db.sources.count() }).toEqual(before);
    expect((await getAnkiImport(first.source_id))!.note_ids).toHaveLength(5);
  });

  it('finishes an interrupted import without duplicates', async () => {
    const col = await readSample();
    const plan = planAnkiImport(col, mappingsOf(col), NOW);
    await importAnkiPlan({ ...plan, notes: plan.notes.slice(0, 2) }, 'english.apkg', { chunkNotes: 1 }, NOW);
    const { counts } = await importCol(col, 'english.apkg', 2);
    expect(counts).toMatchObject({ created: 3, alreadyHad: 2 });
    expect(await db.notes.count()).toBe(5);
    expect(await db.review_logs.count()).toBe(16);
    await expectCardsMatchLogs();
  });

  it('adds a new meaning to a word the library has, without its Anki history', async () => {
    await addNoteWithSenses({ term: 'Bank', senses: [{ meaning_tr: 'banka' }] }, NOW - 1000);
    const { counts } = await importCol(await readSample());
    expect(counts).toMatchObject({ created: 4, sensesAdded: 1 });
    const bank = (await db.notes.where('term_norm').equals('bank').toArray())!;
    expect(bank).toHaveLength(1);
    const senses = await db.senses.where('note_id').equals(bank[0]!.id).toArray();
    expect(senses.map((s) => s.meaning_tr)).toEqual(['banka', 'kıyı (nehir)']);
    const cardIds = (await db.cards.where('note_id').equals(bank[0]!.id).toArray()).map((c) => c.id);
    expect(await db.review_logs.where('card_id').anyOf(cardIds).count()).toBe(0);
    expect(counts.logs).toBe(16 - 1 - 1);
  });

  it('never offers an imported answer for undo', async () => {
    const deck = sampleDeck(NOW - 3 * 86_400_000 - 3_600_000);
    const libs = await nodeLibs();
    const col = await readApkg(await buildApkg(deck, 'anki21', libs), libs);
    await importAnkiPlan(planAnkiImport(col, mappingsOf(col), NOW), 'today.apkg', {}, NOW);
    expect(await db.review_logs.where('reviewed_at').between(NOW - 86_400_000, NOW).count()).toBeGreaterThan(0);
    expect(await getLastUndoableAnswer(NOW)).toBeNull();
  });

  it('imports 1 000 notes with 20 000 answers in under 30 seconds', async () => {
    const libs = await nodeLibs();
    const bytes = await buildApkg(largeDeck(1000, 16), 'anki21b', libs);
    const t = performance.now();
    const col = await readApkg(bytes, libs);
    const { counts } = await importAnkiPlan(planAnkiImport(col, mappingsOf(col), NOW), 'big.apkg', {}, NOW);
    const ms = performance.now() - t;
    expect(ms).toBeLessThan(30_000);
    expect(col.revlog.length).toBe(1000 * (16 + 4));
    expect(counts).toMatchObject({ notes: 1000, created: 1000, cardsMapped: 2000, logs: 20_000 });
    expect(await db.notes.count()).toBe(1000);
    expect(await db.cards.count()).toBe(2000);
    expect(await db.review_logs.count()).toBe(20_000);
    await expectCardsMatchLogs();
  }, 60_000);
});

describe('Sözlükle eşleştir', () => {
  const lex = (id: string, meaning: string) => ({
    id,
    term_id: 'term-bank',
    lemma: 'bank',
    lemma_norm: 'bank',
    term_type: 'word' as const,
    pos: 'noun',
    gloss_en: `gloss ${id}`,
    meaning_tr: meaning,
    ipa: '/bæŋk/',
    updated_at: NOW,
  });

  it('queues the imported words, links matching senses and resumes after a pause', async () => {
    const { source_id } = await importCol(await readSample());
    const rec = await startAnkiEnrich(source_id, NOW);
    expect(rec!.enrich).toMatchObject({ status: 'queued' });
    expect(rec!.enrich.pending).toHaveLength(5);

    const items = await nextAnkiEnrichItems(10, NOW);
    expect(items.map((i) => i.term)).toEqual(['reluctant', 'give up', 'apple', 'bank', 'thorough']);
    const bank = items[3]!;
    expect(await applyAnkiEnrichResult(bank, { term_id: 'term-bank', senses: [lex('L1', 'banka, para kurumu'), lex('L2', 'yığın')] }, NOW)).toBe('matched');
    const senses = await db.senses.where('note_id').equals(bank.note_id).toArray();
    expect(senses.find((s) => s.meaning_tr === 'banka')).toMatchObject({ lexicon_sense_id: 'L1', pos: 'noun', meaning_tr: 'banka' });
    expect(senses.find((s) => s.meaning_tr === 'kıyı (nehir)')!.lexicon_sense_id).toBeNull();
    expect(await db.notes.get(bank.note_id)).toMatchObject({ lexicon_term_id: 'term-bank', ipa: '/bæŋk/' });
    expect(await db.lexicon_cache.count()).toBe(2);
    expect(await applyAnkiEnrichResult(items[0]!, null, NOW)).toBe('unmatched');

    await pauseAnkiEnrich(source_id, NOW + 3_600_000, 'daily_limit', NOW);
    expect(await nextAnkiEnrichItems(10, NOW)).toEqual([]);
    expect(await nextAnkiEnrichWake()).toBe(NOW + 3_600_000);
    const later = await nextAnkiEnrichItems(10, NOW + 3_600_000);
    expect(later.map((i) => i.term)).toEqual(['give up', 'apple', 'thorough']);
    for (const it of later) await applyAnkiEnrichResult(it, null, NOW);
    expect((await getAnkiImport(source_id))!.enrich).toMatchObject({ status: 'done', matched: 1, unmatched: 4, pending: [] });
    // Linking is an ordinary synced edit.
    expect((await db.outbox.toArray()).some((o) => o.table === 'senses' && (o.payload as { lexicon_sense_id: string }).lexicon_sense_id === 'L1')).toBe(true);
  });
});
