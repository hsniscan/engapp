// Interference guard through the data layer (v0.5 İP10, docs/decisions/0052): both orders hold
// back a second word with the same Turkish meaning, and the postponed card is carried to the
// front of the next day.
import { beforeEach, describe, expect, it } from 'vitest';
import { resetDb } from '../test/db';
import { addNoteWithSenses, answerCard, createSource } from './actions';
import { db } from './db';
import { resetNewOrderCaches } from './newOrder';
import { getStudyQueue } from './queries';
import { ensureSettings, updateSettings } from './settings';
import { CARRY_KEY, carryAfter, MAX_CARRY, readCarry, rememberPostponed } from './smart';

const DAY = 86_400_000;
const T = Date.UTC(2026, 10, 2, 9); // 12:00 in Istanbul

const newItems = async (now = T) => (await getStudyQueue({ studyMode: 'word' }, now)).items.filter((i) => i.kind === 'new');
const terms = async (ids: string[]) => (await db.notes.bulkGet(ids)).map((n) => n!.term);

beforeEach(async () => {
  await resetDb();
  resetNewOrderCaches();
  await ensureSettings(T - 100 * DAY);
  await updateSettings({ timezone: 'Europe/Istanbul', level: 'B1', daily_new_limit: 3 }, T - 100 * DAY);
  const src = await createSource({ kind: 'text', title: 'a text' }, T - 50 * DAY);
  const words: [string, string][] = [
    ['small', 'küçük'],
    ['little', 'küçük, az'],
    ['basket', 'sepet'],
    ['pillow', 'yastık'],
    ['candle', 'mum'],
    ['ladder', 'merdiven'],
  ];
  for (const [i, [term, meaning]] of words.entries())
    await addNoteWithSenses({ term, senses: [{ meaning_tr: meaning, source_id: src.id }] }, T - 40 * DAY + i);
});

describe('interference guard (data)', () => {
  it.each(['added', 'smart'] as const)('order %s: one "küçük" word a day, the limit still filled', async (order) => {
    await updateSettings({ new_card_order: order }, T - DAY);
    const q = await getStudyQueue({ studyMode: 'word' }, T);
    const fresh = await terms(q.items.filter((i) => i.kind === 'new').map((i) => i.note_id));
    expect(fresh).toHaveLength(3);
    const kucuk = fresh.filter((t) => t === 'small' || t === 'little');
    // Insertion order reaches "small" first; the smart order may rank both A1 words below the
    // B1 learner's level and pick neither. Either way the guard never lets both in on one day.
    if (order === 'added') expect(kucuk).toEqual(['small']);
    else expect(kucuk.length).toBeLessThanOrEqual(1);
  });

  it('carries the postponed card to the front of the next day', async () => {
    await updateSettings({ new_card_order: 'added' }, T - DAY);
    const q = await getStudyQueue({ studyMode: 'word' }, T);
    expect(await terms(q.items.filter((i) => i.kind === 'new').map((i) => i.note_id))).toEqual(['small', 'basket', 'pillow']);
    const little = (await db.notes.where('term_norm').equals('little').first())!;
    const littleCard = (await db.cards.where('note_id').equals(little.id).toArray()).find((c) => c.card_type === 'recognition')!;
    expect(q.postponed).toEqual([littleCard.id]);
    await rememberPostponed(q.postponed);
    expect(await readCarry()).toEqual([littleCard.id]);
    for (const [i, it] of q.items.entries()) await answerCard({ card_id: it.card_id, rating: 3, duration_ms: 2000 }, T + 60_000 * (i + 1));

    // Next day "little" leads, although insertion order would start with "candle".
    const next = await newItems(T + DAY);
    expect((await terms(next.map((i) => i.note_id)))[0]).toBe('little');
    await answerCard({ card_id: next[0]!.card_id, rating: 3, duration_ms: 2000 }, T + DAY + 60_000);
    await rememberPostponed([]);
    expect(await readCarry()).toEqual([]); // introduced: it falls out of the carry
  });

  it('carryAfter keeps order, drops duplicates and cards no longer new, and is bounded', () => {
    expect(carryAfter(['a', 'b'], ['b', 'c', 'd'], new Set(['a', 'c', 'd']))).toEqual(['a', 'c', 'd']);
    const many = Array.from({ length: MAX_CARRY + 10 }, (_, i) => `id${i}`);
    expect(carryAfter([], many, new Set(many))).toHaveLength(MAX_CARRY);
  });

  it('an unusable stored value reads as no carry', async () => {
    await db.meta.put({ key: CARRY_KEY, value: { not: 'a list' } });
    expect(await readCarry()).toEqual([]);
  });
});
