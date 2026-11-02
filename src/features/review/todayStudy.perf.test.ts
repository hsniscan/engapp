// v0.5.2 (review Y3, ADR 0062): Bugün's numbers on a 5,000-card collection. getTodayStudy used to
// build every mode's queue from scratch (four reads of the cards, today's logs and the load
// plan, plus formatToParts per timestamp). It now reads once and builds the modes from that.
// fake-indexeddb in jsdom is far slower than a browser and the machine is shared, so the guard
// is relative: the whole day (four modes) must cost about what ONE mode's queue costs, not four
// times as much. The absolute bound is loose.
import { beforeAll, describe, expect, it } from 'vitest';
import { db, ensureSettings, getStudyQueue } from '@/data';
import { emptyFsrs } from '@/domain/fsrs';
import { CardState, type Card, type Note, type ReviewLog, type Sense } from '@/domain/types';
import { resetDb } from '@/test/db';
import { getTodayStudy } from './studyModes';

const DAY = 86_400_000;
const N_NOTES = 1_667; // × (recognition + production + cloze) ≈ 5,000 cards

const base = (id: string, t: number) => ({ id, user_id: null, created_at: t, updated_at: t, deleted_at: null, hlc: 'h' });

beforeAll(async () => {
  await resetDb();
  const now = Date.now();
  await ensureSettings(now - 400 * DAY);
  const notes: Note[] = [];
  const senses: Sense[] = [];
  const cards: Card[] = [];
  const logs: ReviewLog[] = [];
  for (let i = 0; i < N_NOTES; i++) {
    const t = now - 300 * DAY + i * 1000;
    const id = (p: string) => `${p}-${String(i).padStart(5, '0')}`;
    const term = `word${i}`;
    notes.push({ ...base(id('n'), t), term, term_norm: term, term_type: 'word', lexicon_term_id: null, ipa: null, tags: [], possible_duplicate: false, level_override: null });
    senses.push({
      ...base(id('s'), t),
      note_id: id('n'),
      sense_no: 1,
      lexicon_sense_id: null,
      pos: null,
      gloss_en: 'gloss',
      meaning_tr: `anlam ${i}`,
      meaning_tr_override: null,
      source_sentence: `This sentence uses ${term} here.`,
      source_sentence_tr: null,
      span: [19, 19 + term.length],
      source_id: null,
    });
    const kind = i % 10;
    const state = kind === 0 ? CardState.New : kind === 1 ? CardState.Learning : CardState.Review;
    const due = kind === 2 ? now - DAY : now + (1 + (i % 60)) * DAY;
    for (const [suffix, type] of [['r', 'recognition'], ['p', 'production'], ['c', 'cloze']] as const) {
      const cardId = id(`c${suffix}`);
      cards.push({
        ...base(cardId, t),
        ...emptyFsrs(t),
        note_id: id('n'),
        sense_id: type === 'recognition' ? null : id('s'),
        card_type: type,
        suspended: false,
        unlocked: true,
        state,
        due: state === CardState.New ? t : due,
        stability: state === CardState.New ? 0 : 20,
        difficulty: state === CardState.New ? 0 : 5,
        reps: state === CardState.New ? 0 : 4,
        last_review: state === CardState.New ? null : now - 5 * DAY,
        ramp_step: state === CardState.Review ? 2 : 0,
      });
      // A few answers a card over the past year (about 13k logs), some of them today.
      if (state !== CardState.New)
        for (let k = 0; k < 3; k++) {
          const at = k === 2 && i % 25 === 0 ? now - 60_000 * (i % 50) : now - (5 + k * 40 + (i % 30)) * DAY;
          logs.push({ id: `${cardId}-l${k}`, user_id: null, card_id: cardId, rating: 3, reviewed_at: at, duration_ms: 4000, device_id: 'perf', undo_of: null, shown_sense_id: null, created_at: at, hlc: 'h' });
        }
    }
  }
  await db.transaction('rw', [db.notes, db.senses, db.cards, db.review_logs], async () => {
    await db.notes.bulkAdd(notes);
    await db.senses.bulkAdd(senses);
    await db.cards.bulkAdd(cards);
    await db.review_logs.bulkAdd(logs);
  });
}, 120_000);

describe('Bugün on 5,000 cards', () => {
  it('computes the whole day for about the cost of one mode', async () => {
    expect(await db.cards.count()).toBe(N_NOTES * 3);
    // Warm the per-day caches (load facts, new-card order rows) the way the first visit does.
    await getTodayStudy();
    const time = async (f: () => Promise<unknown>) => {
      const t0 = performance.now();
      await f();
      return performance.now() - t0;
    };
    const best = async (f: () => Promise<unknown>) => {
      let min = Infinity;
      for (let k = 0; k < 5; k++) min = Math.min(min, await time(f));
      return min;
    };
    const one = await best(() => getStudyQueue({ studyMode: 'word' }));
    const day = await best(() => getTodayStudy());
    const study = await getTodayStudy();
    console.info(`[perf] 5000 cards: one mode ${one.toFixed(0)} ms, the whole day ${day.toFixed(0)} ms`);
    expect(study.left).toBeGreaterThan(100);
    // Four modes from one read: well under the old 4× (+ the extra per-mode reads).
    expect(day).toBeLessThan(one * 2 + 25);
    expect(day).toBeLessThan(10_000);
  }, 120_000);
});
