// "Eller serbest" (ADR 0051): the round reads each word, pauses, the meaning and the sentence;
// Duraklat / Devam / Sonraki / Bitir; and it writes nothing at all (no FSRS state, no review or
// practice log, no encounter, nothing queued for sync).
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { addNoteWithSenses, db, ensureSettings } from '@/data';
import { handsFreeItemsFor } from '@/data/handsFree';
import { CardState, type LexiconExample } from '@/domain/types';
import { resetDb } from '@/test/db';
import { renderRoute } from '@/test/ui';
import type { HandsFreeVoice } from './handsFreeVoice';
import { HandsFreeScreen } from './HandsFreeScreen';
import type { HandsFreeTimers } from './useHandsFree';

beforeEach(async () => {
  await resetDb();
  await ensureSettings();
});

/** A studied, hard word (so "Zorlandıklarım" picks it). */
async function hardWord(term: string, meaning: string, opts: { sentence?: string; lex?: string } = {}) {
  const { createdCards, note } = await addNoteWithSenses({
    term,
    senses: [
      {
        meaning_tr: meaning,
        ...(opts.lex ? { lexicon_sense_id: opts.lex } : {}),
        ...(opts.sentence ? { source_sentence: opts.sentence, span: [opts.sentence.indexOf(term), opts.sentence.indexOf(term) + term.length] as [number, number] } : {}),
      },
    ],
  });
  const rec = createdCards.find((c) => c.card_type === 'recognition')!;
  await db.cards.update(rec.id, { state: CardState.Review, reps: 4, difficulty: 8, last_review: Date.now() - 86_400_000 });
  return { cardId: rec.id, noteId: note.id };
}

/** Every table's rows, to prove the round changed nothing. */
async function snapshot() {
  const out: Record<string, unknown[]> = {};
  for (const table of db.tables) {
    if (table.name === 'error_log') continue;
    out[table.name] = await table.toArray();
  }
  return out;
}

/** A voice that records what it was asked to say and finishes on the next tick. */
function fakeVoice() {
  const said: string[] = [];
  let held: (() => void) | null = null;
  let hold = false;
  const voice: HandsFreeVoice = {
    english: (text, _v, onDone) => {
      said.push(`en:${text}`);
      if (hold) held = onDone;
      else setTimeout(onDone, 0);
    },
    turkish: (text, onDone) => {
      said.push(`tr:${text}`);
      if (hold) held = onDone;
      else setTimeout(onDone, 0);
    },
    stop: () => said.push('stop'),
  };
  return {
    voice,
    said,
    hold: (v: boolean) => (hold = v),
    release: () => {
      const f = held;
      held = null;
      f?.();
    },
  };
}

const quickTimers: HandsFreeTimers = {
  setTimeout: (fn) => setTimeout(fn, 0),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

describe('hands-free round', () => {
  it('reads each word, then its meaning, then a shared sentence first; and writes nothing', async () => {
    await hardWord('reluctant', 'isteksiz', { lex: 'lx-1', sentence: 'I was reluctant at first.' });
    await db.lexicon_examples.put({
      id: 'e1',
      sense_id: 'lx-1',
      context: 'daily',
      level_band: 'B1',
      text_en: 'She was reluctant to leave.',
      span: [8, 17],
      translations: { tr: 'Gitmeye isteksizdi.' },
      status: 'active',
      updated_at: 1,
    } satisfies LexiconExample);
    await hardWord('scarce', 'kıt');
    const before = await snapshot();

    const v = fakeVoice();
    renderRoute(<HandsFreeScreen voice={v.voice} timers={quickTimers} />, {
      path: '/practice',
      url: '/practice?mode=audio&source=hard&size=10',
    });
    await userEvent.click(await screen.findByTestId('hands-free-start'));
    expect(await screen.findByText('Tur bitti', {}, { timeout: 3000 })).toBeInTheDocument();
    const spoken = v.said.filter((s) => s !== 'stop');
    // Two words, each English → Turkish (→ sentence): the order inside a word is fixed.
    const at = (s: string) => spoken.indexOf(s);
    expect(at('en:reluctant')).toBeLessThan(at('tr:isteksiz'));
    expect(at('tr:isteksiz')).toBeLessThan(at('en:She was reluctant to leave.'));
    expect(spoken).not.toContain('en:I was reluctant at first.');
    expect(at('en:scarce')).toBeLessThan(at('tr:kıt'));
    expect(spoken).toHaveLength(5);

    expect(await snapshot()).toEqual(before);
  });

  it('Duraklat stops the voice and holds the round; Devam replays the step; Sonraki and Bitir', async () => {
    await hardWord('reluctant', 'isteksiz');
    await hardWord('scarce', 'kıt');
    const before = await snapshot();
    const v = fakeVoice();
    v.hold(true);
    renderRoute(<HandsFreeScreen voice={v.voice} timers={quickTimers} />, {
      path: '/practice',
      url: '/practice?mode=audio&source=hard&size=10',
    });
    await userEvent.click(await screen.findByTestId('hands-free-start'));
    const first = v.said[0]!;
    expect(first).toMatch(/^en:/);

    await userEvent.click(screen.getByRole('button', { name: 'Duraklat' }));
    expect(v.said).toContain('stop');
    expect(screen.getByText('Duraklatıldı')).toBeInTheDocument();
    // A late "done" from the stopped voice does not move the round.
    act(() => v.release());
    expect(v.said.filter((s) => s.startsWith('tr:'))).toEqual([]);

    await userEvent.click(screen.getByRole('button', { name: 'Devam' }));
    expect(v.said.filter((s) => s === first)).toHaveLength(2);

    await userEvent.click(screen.getByRole('button', { name: 'Sonraki' }));
    const second = v.said.filter((s) => s.startsWith('en:')).at(-1)!;
    expect(second).not.toBe(first);
    expect(screen.getByText('2 / 2')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Bitir' }));
    expect(await screen.findByText('Tur bitti')).toBeInTheDocument();
    expect(await snapshot()).toEqual(before);
  });

  it('shows the empty state when nothing was studied yet', async () => {
    await addNoteWithSenses({ term: 'fresh', senses: [{ meaning_tr: 'taze' }] });
    renderRoute(<HandsFreeScreen voice={fakeVoice().voice} timers={quickTimers} />, {
      path: '/practice',
      url: '/practice?mode=audio&source=hard&size=10',
    });
    expect(await screen.findByText('Dinlenecek kelime yok')).toBeInTheDocument();
  });

  it('items: one per note, the user’s meaning first, deleted words left out', async () => {
    const a = await hardWord('reluctant', 'isteksiz');
    const b = await hardWord('scarce', 'kıt');
    const sense = await db.senses.where('note_id').equals(a.noteId).first();
    await db.senses.update(sense!.id, { meaning_tr_override: 'gönülsüz' });
    await db.notes.update(b.noteId, { deleted_at: 1 });
    const items = await handsFreeItemsFor([a.cardId, a.cardId, b.cardId, 'missing']);
    expect(items.map((i) => [i.term, i.meaning])).toEqual([['reluctant', 'gönülsüz']]);
  });
});
