// Acceptance criterion 4 smoke test: 1,000 cards, session opens fast and a card switch is
// quick. fake-indexeddb in jsdom is far slower than a browser's IndexedDB, so the limits
// here are loose guards against regressions; real-browser timings come from
// scripts/study-qa.ts.
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import { db, ensureSettings, getCardView, getStudyQueue } from '@/data';
import { emptyFsrs } from '@/domain/fsrs';
import { CardState, type Card, type Note, type Sense } from '@/domain/types';
import { resetDb } from '@/test/db';
import { renderRoute } from '@/test/ui';
import { ReviewScreen } from './ReviewScreen';

const DAY = 86_400_000;
const N_NOTES = 334; // × (recognition + production + cloze) ≈ 1,000 cards

const base = (id: string, t: number) => ({
  id,
  user_id: null,
  created_at: t,
  updated_at: t,
  deleted_at: null,
  hlc: 'h',
});

beforeAll(async () => {
  await resetDb();
  const now = Date.now();
  await ensureSettings(now - 200 * DAY);
  const notes: Note[] = [];
  const senses: Sense[] = [];
  const cards: Card[] = [];
  for (let i = 0; i < N_NOTES; i++) {
    const t = now - 100 * DAY + i * 1000;
    const id = (p: string) => `${p}-${String(i).padStart(5, '0')}`;
    const term = `word${i}`;
    const sentence = `This sentence uses ${term} here.`;
    notes.push({
      ...base(id('n'), t),
      term,
      term_norm: term,
      term_type: 'word',
      lexicon_term_id: null,
      ipa: null,
      tags: [],
      possible_duplicate: false,
      level_override: null,
    });
    senses.push({
      ...base(id('s'), t),
      note_id: id('n'),
      sense_no: 1,
      lexicon_sense_id: null,
      pos: null,
      gloss_en: 'gloss',
      meaning_tr: `anlam ${i}`,
      meaning_tr_override: null,
      source_sentence: sentence,
      source_sentence_tr: null,
      span: [19, 19 + term.length],
      source_id: null,
    });
    // A realistic mix: most cards in review (a tenth due today), some new, a few learning.
    const kind = i % 10;
    const state = kind === 0 ? CardState.New : kind === 1 ? CardState.Learning : CardState.Review;
    const due = kind === 2 ? now - DAY : now + (1 + (i % 40)) * DAY;
    for (const [suffix, type] of [
      ['r', 'recognition'],
      ['p', 'production'],
      ['c', 'cloze'],
    ] as const) {
      cards.push({
        ...base(id(`c${suffix}`), t),
        ...emptyFsrs(t),
        note_id: id('n'),
        sense_id: type === 'recognition' ? null : id('s'),
        card_type: type,
        suspended: false,
        unlocked: true,
        state,
        due: state === CardState.New ? t : due,
        stability: state === CardState.New ? 0 : 10,
        difficulty: state === CardState.New ? 0 : 5,
        reps: state === CardState.New ? 0 : 3,
        last_review: state === CardState.New ? null : now - 5 * DAY,
      });
    }
  }
  await db.transaction('rw', [db.notes, db.senses, db.cards], async () => {
    await db.notes.bulkAdd(notes);
    await db.senses.bulkAdd(senses);
    await db.cards.bulkAdd(cards);
  });
});

describe('1,000-card performance', () => {
  it('builds the queue and the first card view quickly', async () => {
    expect(await db.cards.count()).toBe(N_NOTES * 3);
    const t0 = performance.now();
    const q = await getStudyQueue();
    const queueMs = performance.now() - t0;
    const t1 = performance.now();
    const view = await getCardView(q.items[0]!.card_id);
    const viewMs = performance.now() - t1;
    console.info(
      `[perf] 1000 cards: getStudyQueue ${queueMs.toFixed(0)} ms (${q.items.length} items), getCardView ${viewMs.toFixed(0)} ms`,
    );
    expect(view).not.toBeNull();
    expect(q.items.length).toBeGreaterThan(30);
    // Loose bounds: the machine is shared; the console line above is the real measure.
    expect(queueMs).toBeLessThan(3000);
    expect(viewMs).toBeLessThan(1000);
  });

  it('renders the first card and switches to the prefetched next card', async () => {
    const t0 = performance.now();
    renderRoute(<ReviewScreen studyMode="word" />, { path: '/review' });
    await screen.findByRole('button', { name: 'Cevabı göster' }, { timeout: 5000 });
    await waitFor(() => expect(document.querySelector('[data-card-type]')).not.toBeNull(), {
      timeout: 5000,
    });
    const openMs = performance.now() - t0;

    act(() => void fireEvent.keyDown(window, { key: ' ' }));
    await screen.findByRole('group', { name: 'Ne kadar iyi hatırladın?' });
    // Give the prefetch of the next card a moment, as a user's reading time would.
    await new Promise((r) => setTimeout(r, 300));
    const before = document.querySelector('[data-card-type]');
    const t1 = performance.now();
    act(() => void fireEvent.keyDown(window, { key: '3' }));
    const after = document.querySelector('[data-card-type]');
    const switchMs = performance.now() - t1;
    console.info(
      `[perf] 1000 cards: first card ${openMs.toFixed(0)} ms, card switch ${switchMs.toFixed(1)} ms`,
    );
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
    expect(after).toHaveAttribute('data-flipped', 'false');
    expect(openMs).toBeLessThan(8000);
    // The switch is synchronous (the next card is on screen without awaiting anything, as
    // asserted above); the time bound only catches a gross regression.
    expect(switchMs).toBeLessThan(500);
  }, 30_000);
});
