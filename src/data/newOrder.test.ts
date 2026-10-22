// Smart new-card order through the data layer (docs/decisions/0039): getStudyQueue reads the
// notes' levels, sources and confusable pairs and keeps the day's sequence across rebuilds.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseClientLevels } from '../domain/level';
import { emptyFsrs } from '../domain/fsrs';
import { CardState, type Card, type Note, type Sense } from '../domain/types';
import { resetDb } from '../test/db';
import { addNoteWithSenses, answerCard, createSource } from './actions';
import { reportConfusion } from './contrast';
import { db } from './db';
import { setLevelDataForTests } from './levelData';
import { resetNewOrderCaches } from './newOrder';
import { getStudyQueue } from './queries';
import { ensureSettings, updateSettings } from './settings';

const DAY = 86_400_000;
// 12:00 in Istanbul (the device time zone of the tests may differ; settings set it below).
const T = Date.UTC(2026, 9, 22, 9);

// A small level file: B1 words, lower words and C2 words.
const B1 = ['harbor', 'glimpse', 'thrive', 'vessel', 'wander', 'sturdy', 'linger', 'meadow', 'ponder', 'quiver', 'ripple', 'shiver'];
const A2 = ['basket', 'pillow', 'carpet', 'button', 'candle', 'kettle', 'ladder', 'mirror'];
const C2 = ['obfuscate', 'perfunctory', 'quixotic', 'recalcitrant', 'sycophant', 'truculent', 'ubiquity', 'vicissitude'];
const LEVELS = parseClientLevels(
  [...B1.map((w) => `${w}\t4.0\tn:B1:j`), ...A2.map((w) => `${w}\t4.5\tn:A2:j`), ...C2.map((w) => `${w}\t2.5\tn:C2:o`)].join('\n'),
);

async function seedImported(terms: string[], sourceId: string, created: number): Promise<void> {
  for (const [i, term] of terms.entries())
    await addNoteWithSenses({ term, senses: [{ meaning_tr: `anlam ${term}`, source_id: sourceId }] }, created + i);
}

const newIds = async (now = T) => (await getStudyQueue({}, now)).items.filter((i) => i.kind === 'new').map((i) => i.note_id);
const termsOf = async (noteIds: string[]) => (await db.notes.bulkGet(noteIds)).map((n) => n!.term);

beforeEach(async () => {
  await resetDb();
  resetNewOrderCaches();
  setLevelDataForTests(LEVELS);
  await ensureSettings(T - 200 * DAY);
  await updateSettings({ timezone: 'Europe/Istanbul', level: 'B1', daily_new_limit: 10 }, T - 200 * DAY);
});

afterEach(() => setLevelDataForTests(null));

describe('getStudyQueue with the smart order', () => {
  it('mixes levels for the learner and never offers C2 to a B1 learner while others are left', async () => {
    const src = await createSource({ kind: 'text', title: 'old text' }, T - 90 * DAY);
    // Insertion order would start with the C2 words.
    await seedImported([...C2, ...A2, ...B1], src.id, T - 60 * DAY);
    const terms = await termsOf(await newIds());
    expect(terms).toHaveLength(10);
    expect(terms.filter((t) => C2.includes(t))).toEqual([]);
    expect(terms.filter((t) => B1.includes(t)).length).toBeGreaterThanOrEqual(6);
    expect(terms.filter((t) => A2.includes(t)).length).toBeGreaterThanOrEqual(3);
  });

  it('"Eklenme sırası" keeps insertion order', async () => {
    const src = await createSource({ kind: 'text', title: 'old text' }, T - 90 * DAY);
    await seedImported([...C2, ...A2, ...B1], src.id, T - 60 * DAY);
    await updateSettings({ new_card_order: 'added' }, T - DAY);
    expect(await termsOf(await newIds())).toEqual([...C2, ...A2.slice(0, 2)]);
  });

  it('puts words the user added by hand first, in the order they were added', async () => {
    const src = await createSource({ kind: 'text', title: 'old text' }, T - 90 * DAY);
    await seedImported(B1, src.id, T - 60 * DAY);
    await addNoteWithSenses({ term: 'quixotic', senses: [{ meaning_tr: 'hayalperest' }] }, T - 2 * DAY);
    await addNoteWithSenses({ term: 'basket', senses: [{ meaning_tr: 'sepet' }] }, T - DAY);
    expect((await termsOf(await newIds())).slice(0, 2)).toEqual(['quixotic', 'basket']);
  });

  it('is stable within the day: answering a new card continues the same sequence', async () => {
    const src = await createSource({ kind: 'text', title: 'old text' }, T - 90 * DAY);
    await seedImported([...C2, ...A2, ...B1], src.id, T - 60 * DAY);
    const first = await getStudyQueue({}, T);
    const order = first.items.filter((i) => i.kind === 'new');
    await answerCard({ card_id: order[0]!.card_id, rating: 3, duration_ms: 3000 }, T + 60_000);
    await answerCard({ card_id: order[1]!.card_id, rating: 1, duration_ms: 3000 }, T + 120_000);
    const later = (await getStudyQueue({}, T + 3 * 3600_000)).items.filter((i) => i.kind === 'new');
    expect(later.map((i) => i.card_id)).toEqual(order.slice(2).map((i) => i.card_id));
  });

  it('gives two accounts with the same cards a different order', async () => {
    const src = await createSource({ kind: 'text', title: 'old text' }, T - 90 * DAY);
    await seedImported(B1, src.id, T - 60 * DAY);
    const settings = (await db.settings.get('settings'))!;
    await db.settings.put({ ...settings, user_id: 'user-a' });
    const a = await termsOf(await newIds());
    resetNewOrderCaches();
    await db.settings.put({ ...settings, user_id: 'user-b' });
    const b = await termsOf(await newIds());
    expect(new Set(a)).not.toEqual(new Set(B1.slice(0, 10)));
    expect(a).not.toEqual(b);
  });

  it('does not introduce a reported confusion pair on the same day', async () => {
    const src = await createSource({ kind: 'text', title: 'old text' }, T - 90 * DAY);
    await seedImported(['borrow', 'lend', ...A2, ...B1], src.id, T - 60 * DAY);
    const notes = await db.notes.toArray();
    const id = (t: string) => notes.find((n) => n.term === t)!.id;
    await reportConfusion(id('borrow'), id('lend'), {}, T - DAY);
    const terms = await termsOf(await newIds());
    expect(terms).toHaveLength(10);
    expect(terms.includes('borrow') && terms.includes('lend')).toBe(false);
  });

  it('lets a recent import lead over an older pile', async () => {
    const old = await createSource({ kind: 'text', title: 'old text' }, T - 90 * DAY);
    await seedImported(B1.slice(0, 10), old.id, T - 80 * DAY);
    const fresh = await createSource({ kind: 'text', title: 'new text' }, T - DAY);
    await seedImported(A2.slice(0, 3), fresh.id, T - DAY);
    const terms = await termsOf(await newIds());
    for (const t of A2.slice(0, 3)) expect(terms).toContain(t);
  });
});

describe('getStudyQueue with the smart order: speed', () => {
  it('builds a 10,000-card queue with 3,000 new cards quickly', async () => {
    const now = T;
    const notes: Note[] = [];
    const senses: Sense[] = [];
    const cards: Card[] = [];
    const base = (id: string, t: number) => ({ id, user_id: null, created_at: t, updated_at: t, deleted_at: null, hlc: 'h' });
    for (let i = 0; i < 5000; i++) {
      const t = now - 150 * DAY + i * 60_000;
      const term = `${B1[i % B1.length]}${i}`;
      notes.push({ ...base(`n${i}`, t), term, term_norm: term, term_type: 'word', lexicon_term_id: null, ipa: null, tags: [], possible_duplicate: false, level_override: null });
      senses.push({ ...base(`s${i}`, t), note_id: `n${i}`, sense_no: 1, lexicon_sense_id: null, pos: null, gloss_en: null, meaning_tr: `anlam ${i % 1500}`, meaning_tr_override: null, source_sentence: null, source_sentence_tr: null, span: null, source_id: i % 2 ? 'src' : null });
      const studied = i < 3500;
      for (const [k, type] of (['recognition', 'production'] as const).entries()) {
        const isNew = !studied || (k === 1 && i % 2 === 0);
        cards.push({
          ...base(`c${i}-${k}`, t),
          ...emptyFsrs(t),
          note_id: `n${i}`,
          sense_id: k ? `s${i}` : null,
          card_type: type,
          suspended: false,
          unlocked: true,
          state: isNew ? CardState.New : CardState.Review,
          due: isNew ? t : now + ((i % 30) - 3) * DAY,
          stability: isNew ? 0 : 10,
          reps: isNew ? 0 : 4,
        });
      }
    }
    await db.transaction('rw', [db.notes, db.senses, db.cards], async () => {
      await db.notes.bulkAdd(notes);
      await db.senses.bulkAdd(senses);
      await db.cards.bulkAdd(cards);
    });
    await updateSettings({ catchup_auto: false }, now); // no catch-up ramp: new cards are wanted
    const tc = performance.now();
    await getStudyQueue({}, now); // cold: reads the notes' facts (as the home screen does first)
    const coldMs = performance.now() - tc;
    const t0 = performance.now();
    const q = await getStudyQueue({}, now);
    const smartMs = performance.now() - t0;
    await updateSettings({ new_card_order: 'added' }, now);
    const t1 = performance.now();
    await getStudyQueue({}, now);
    const plainMs = performance.now() - t1;
    console.info(`[perf] 10k cards (3,250 new): getStudyQueue smart cold ${coldMs.toFixed(0)} ms, warm ${smartMs.toFixed(0)} ms, insertion order ${plainMs.toFixed(0)} ms`);
    expect(q.counts.new).toBe(10);
    // fake-indexeddb is far slower than a browser's IndexedDB: a loose guard.
    expect(smartMs).toBeLessThan(3000);
    expect(coldMs).toBeLessThan(10_000);
  }, 60_000);
});
