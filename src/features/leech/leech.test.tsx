// Leech cards in the review session (plan acceptance criterion 5): the 6th lapse is flagged
// in that session with at least three paths, nothing is suspended unless the user asks; the
// "mixed it up" picker leads to a contrast card; Stats lists the leeches.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { addNoteWithSenses, answerCard, db, ensureSettings } from '@/data';
import { LEECH_LAPSES } from '@/domain/leech';
import { Rating, type Id } from '@/domain/types';
import { ReviewScreen } from '@/features/review/ReviewScreen';
import { resetDb } from '@/test/db';
import { renderRoute } from '@/test/ui';
import { Toaster } from '@/ui';
import type { ContrastRequest, ContrastResponse } from '@/ai/contrast';
import { ContrastEditor } from './ContrastEditor';
import { LeechStatsSection } from './LeechStats';

const DAY = 86_400_000;
const press = (key: string) => act(() => void fireEvent.keyDown(window, { key }));

/** Easy, then `lapses` × (Again, Easy), long ago; the card is due now. */
async function forget(cardId: Id, lapses: number) {
  let t = Date.now() - 200 * DAY;
  const answer = async (rating: 1 | 4) => {
    t += 3 * DAY;
    await answerCard({ card_id: cardId, rating, duration_ms: 3000 }, t);
  };
  await answer(Rating.Easy);
  for (let i = 0; i < lapses; i++) {
    await answer(Rating.Again);
    await answer(Rating.Easy);
  }
  await db.cards.update(cardId, { due: Date.now() - 60_000 });
}

let bankRecognition: Id;

beforeEach(async () => {
  await resetDb();
  const t = Date.now() - 300 * DAY;
  await ensureSettings(t);
  const bank = await addNoteWithSenses(
    {
      term: 'bank',
      senses: [
        { meaning_tr: 'banka', source_sentence: 'I went to the bank.', span: [14, 18] },
        { meaning_tr: 'kıyı', source_sentence: 'We sat on the river bank.', span: [20, 24] },
      ],
    },
    t,
  );
  bankRecognition = bank.createdCards.find((c) => c.card_type === 'recognition')!.id;
  // Only the recognition card of "bank" and one new word are studied here.
  for (const c of bank.createdCards) if (c.id !== bankRecognition) await db.cards.update(c.id, { suspended: true });
  await addNoteWithSenses({ term: 'light', senses: [{ meaning_tr: 'hafif' }] }, t + 1000);
  const light = await db.cards.toArray();
  for (const c of light) if (c.card_type !== 'recognition') await db.cards.update(c.id, { suspended: true });
});

/** Answer the cards on screen until `term` shows, then answer it with `key`. */
async function answerWhen(term: string, key: string) {
  for (let i = 0; i < 4; i++) {
    const shown = await screen.findByText(/^(bank|light)$/, { selector: 'p[lang="en"]' });
    await press(' ');
    await screen.findByRole('group', { name: 'Ne kadar iyi hatırladın?' });
    if (shown.textContent === term) {
      await press(key);
      return;
    }
    await press('3');
  }
  throw new Error(`${term} never showed`);
}

describe('leech in the review session', () => {
  it('flags the 6th lapse at once, offers at least three paths and suspends nothing by itself', async () => {
    await forget(bankRecognition, LEECH_LAPSES - 1);
    const user = userEvent.setup();
    renderRoute(
      <>
        <ReviewScreen />
        <Toaster />
      </>,
      { path: '/review' },
    );
    await answerWhen('bank', '1');

    const flag = await screen.findByTestId('leech-flag');
    expect(flag).toHaveTextContent('“bank” kartını 6. kez unuttun.');
    expect((await db.cards.get(bankRecognition))!.suspended).toBe(false);
    const logsBefore = await db.review_logs.count();

    await user.click(within(flag).getByRole('button', { name: 'Başka yoldan bakalım' }));
    const sheet = await screen.findByTestId('leech-sheet');
    expect(within(sheet.ownerDocument.body).getByRole('dialog', { name: 'Bu karta başka yoldan bakalım' })).toBeInTheDocument();
    await within(sheet).findByRole('button', { name: /Ara ver ya da baştan başla/ });
    const paths = [...sheet.querySelectorAll('[data-path]')].map((p) => p.getAttribute('data-path'));
    expect(paths.length).toBeGreaterThanOrEqual(3);
    expect(paths).toEqual(expect.arrayContaining(['mnemonic', 'confusion', 'split', 'restart']));
    expect(within(sheet).getByText(/sen istemedikçe askıya alınmaz/)).toBeInTheDocument();
    expect((await db.cards.get(bankRecognition))!.suspended).toBe(false);

    // Start over, by the user only, behind a confirmation; the logs stay as they are.
    await user.click(within(sheet).getByRole('button', { name: /Ara ver ya da baştan başla/ }));
    await user.click(within(sheet).getByRole('button', { name: 'Baştan başla' }));
    const confirm = within(sheet).getByRole('group', { name: 'Bu kart baştan başlasın mı?' });
    await user.click(within(confirm).getByRole('button', { name: 'Baştan başla' }));
    expect(await screen.findByText('Kart baştan başladı')).toBeInTheDocument();
    const cards = await db.cards.where('note_id').equals((await db.cards.get(bankRecognition))!.note_id).toArray();
    expect(cards.find((c) => c.id === bankRecognition)).toMatchObject({ suspended: true, lapses: LEECH_LAPSES });
    expect(cards.filter((c) => c.card_type === 'recognition' && c.id !== bankRecognition && !c.suspended)).toHaveLength(1);
    expect(await db.review_logs.count()).toBe(logsBefore);
  });

  it('a 6-lapse card shows the marker on its front; the menu opens the sheet', async () => {
    await forget(bankRecognition, LEECH_LAPSES);
    const user = userEvent.setup();
    renderRoute(<ReviewScreen />, { path: '/review' });
    for (let i = 0; i < 3; i++) {
      const shown = await screen.findByText(/^(bank|light)$/, { selector: 'p[lang="en"]' });
      if (shown.textContent === 'bank') break;
      await press(' ');
      await press('3');
    }
    expect(await screen.findByTestId('leech-marker')).toHaveTextContent('Zorlandığın kart');
    await user.click(screen.getByRole('button', { name: 'Kart seçenekleri' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Başka yoldan bak' }));
    expect(await screen.findByTestId('leech-sheet')).toBeInTheDocument();
  });

  it('after Again: "mixed it up?" → pick a word → a contrast card written by the user', async () => {
    const user = userEvent.setup();
    renderRoute(
      <>
        <ReviewScreen />
        <Toaster />
      </>,
      { path: '/review' },
    );
    await answerWhen('bank', '1');
    const prompt = await screen.findByTestId('confusion-prompt');
    expect(prompt).toHaveTextContent('“bank” başka bir kelimeyle mi karıştı?');
    await user.click(within(prompt).getByRole('button', { name: 'Kelimeyi seç' }));
    const picker = await screen.findByTestId('confusion-picker');
    await user.click(await within(picker).findByRole('button', { name: /light/ }));
    expect(await screen.findByText(/Not edildi: “bank” ile “light”/)).toBeInTheDocument();
    expect(await db.user_content.where('kind').equals('confusion').count()).toBe(1);

    await user.click(screen.getByRole('button', { name: 'Fark kartı yap' }));
    const editor = await screen.findByTestId('contrast-editor');
    // No lexicon senses: no AI request, the user writes the difference.
    expect(within(editor).getByText(/ortak sözlükte olmadığı/)).toBeInTheDocument();
    await user.click(within(editor).getByRole('button', { name: 'Fark kartını ekle' }));
    expect(await within(editor).findByText('Fark boş olamaz.')).toBeInTheDocument();
    await user.type(within(editor).getByLabelText(/^Fark/), 'bank para yeri, light hafif.');
    await user.click(within(editor).getByRole('button', { name: 'Fark kartını ekle' }));
    expect(await screen.findByText('Fark kartı eklendi')).toBeInTheDocument();
    const note = (await db.notes.toArray()).find((n) => n.term_type === 'contrast')!;
    expect(note.term).toBe('bank ↔ light');
    expect(await db.cards.where('note_id').equals(note.id).count()).toBe(1);
    expect(JSON.stringify(await db.lexicon_pair_notes.toArray())).not.toContain('para yeri');
  });
});

describe('Stats: Zorlandıklarım', () => {
  it('lists leeches with a practice link and opens the sheet', async () => {
    await forget(bankRecognition, LEECH_LAPSES);
    const user = userEvent.setup();
    renderRoute(<LeechStatsSection />);
    const section = await screen.findByTestId('leech-stats');
    const row = await within(section).findByRole('button', { name: /bank/ });
    expect(row).toHaveTextContent('6 kez unuttun');
    const practice = within(section).getByRole('link', { name: 'Bunları çalış' });
    expect(practice.getAttribute('href')).toMatch(/^\/practice\?source=list&size=10&notes=/);
    expect(within(section).getByRole('link', { name: 'Zorlandığın tüm kelimeleri çalış' }).getAttribute('href')).toBe(
      '/practice?source=hard&size=10',
    );
    await user.click(row);
    await waitFor(() => expect(screen.getByTestId('leech-sheet')).toBeInTheDocument());
  });

  it('says so when there is no leech', async () => {
    renderRoute(<LeechStatsSection />);
    expect(await screen.findByText(/Henüz 6 kez unuttuğun bir kart yok/)).toBeInTheDocument();
  });
});

describe('contrast editor with ai-contrast (fixture, no live call)', () => {
  it('sends only the two lexicon sense ids, shows the shared difference and keeps edits private', async () => {
    const add = async (term: string, meaning: string, lex: string) =>
      (await addNoteWithSenses({ term, senses: [{ meaning_tr: meaning, lexicon_sense_id: lex, pos: 'verb' }] })).note;
    const affect = await add('affect', 'etkilemek', 'ls-affect');
    const effect = await add('effect', 'etki', 'ls-effect');
    const sense = async (noteId: Id) => (await db.senses.where('note_id').equals(noteId).first())!.id;
    const pair = {
      a: { note_id: affect.id, term: 'affect', term_norm: 'affect', sense_id: await sense(affect.id) },
      b: { note_id: effect.id, term: 'effect', term_norm: 'effect', sense_id: await sense(effect.id) },
    };
    const calls: ContrastRequest[] = [];
    const response: ContrastResponse = {
      prompt_version: 'contrast-v1',
      ai_called: true,
      model: 'm',
      key: 'ls-affect|ls-effect',
      note: {
        id: 'pn-c1',
        key: 'ls-affect|ls-effect',
        a: { sense_id: 'ls-affect', lemma: 'affect', sentence_en: 'Noise can affect sleep.', span: [10, 16], sentence_tr: 'Gürültü uykuyu etkileyebilir.' },
        b: { sense_id: 'ls-effect', lemma: 'effect', sentence_en: 'The effect was clear.', span: [4, 10], sentence_tr: null },
        difference_tr: 'affect bir fiildir (etkilemek), effect bir isimdir (etki).',
        updated_at: 1,
      },
      counts: { dropped: {} },
      usage: null,
    };
    const deps = {
      suggest: async (input: ContrastRequest) => {
        calls.push(input);
        return response;
      },
      isOnline: () => true,
      isSignedIn: async () => true,
    };
    const user = userEvent.setup();
    renderRoute(
      <>
        <ContrastEditor pair={pair} requestDeps={deps} />
        <Toaster />
      </>,
    );
    const editor = await screen.findByTestId('contrast-editor');
    await user.click(await within(editor).findByRole('button', { name: 'Farkı açıklat' }));
    await waitFor(() => expect(within(editor).getByLabelText(/^Fark/)).toHaveValue(response.note.difference_tr));
    expect(calls).toEqual([{ sense_ids: ['ls-affect', 'ls-effect'] }]);
    expect(within(editor).getByText('Noise can affect sleep.')).toBeInTheDocument();
    const field = within(editor).getByLabelText(/^Fark/);
    await user.clear(field);
    await user.type(field, 'Benim notum: affect fiil.');
    await user.click(within(editor).getByRole('button', { name: 'Fark kartını ekle' }));
    expect(await screen.findByText('Fark kartı eklendi')).toBeInTheDocument();
    expect(JSON.stringify(await db.lexicon_pair_notes.toArray())).not.toContain('Benim notum');
    expect((await db.user_content.where('kind').equals('contrast').first())!.text).toBe('Benim notum: affect fiil.');
  });
});
