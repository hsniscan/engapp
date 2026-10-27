import { configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { addNoteWithSenses, applyWordBankPage, db, markKnown, updateSettings } from '@/data';
import { resetDb } from '@/test/db';
import { renderRoute } from '@/test/ui';
import type { WordBankRow } from '../../../supabase/functions/_shared/wordbank-contract';
import { WordBankPage, WordBankPanel } from './WordBankPage';

// The full suite runs many jsdom files at once; give the live queries room.
configure({ asyncUtilTimeout: 5000 });

let seq = 0;
const row = (
  lemma: string,
  cefr: WordBankRow['cefr'],
  meaning: string,
  zipf = 4,
  pos: WordBankRow['pos'] = 'noun',
): WordBankRow => ({
  lemma_norm: lemma,
  pos,
  lemma,
  cefr,
  list_source: 'cefrj',
  zipf,
  lexicon_term_id: null,
  senses: [
    {
      meaning_tr: meaning,
      example_en: `I like the ${lemma} here.`,
      example_tr: `Buradaki ${meaning} hoşuma gidiyor.`,
      sense_id: null,
    },
  ],
  retired: false,
  server_seq: ++seq,
});

const rowTerms = () =>
  within(screen.getByRole('list', { name: 'Kelimeler' }))
    .queryAllByTestId('word-bank-row')
    .map((li) => li.querySelector('[lang="en"]')?.textContent);

const noteTerms = async () => (await db.notes.toArray()).map((n) => n.term).sort();

const renderBank = () => renderRoute(<WordBankPanel />, { path: '/decks', url: '/decks?tab=bank' });

beforeEach(async () => {
  seq = 0;
  await resetDb();
  await updateSettings({ level: 'A2' });
});

describe('word bank (Desteler › Kelime Bankası)', () => {
  it('opens on the user level and hides words already known or carded', async () => {
    await applyWordBankPage([
      row('garden', 'A2', 'bahçe', 5),
      row('kitchen', 'A2', 'mutfak', 4.5),
      row('ticket', 'A2', 'bilet', 4.8),
      row('village', 'A2', 'köy', 4.2),
      row('apple', 'A1', 'elma'),
      row('opinion', 'B1', 'görüş'),
    ]);
    await markKnown('ticket', 'manual');
    await addNoteWithSenses({ term: 'village', senses: [{ meaning_tr: 'köy' }] });

    const user = userEvent.setup();
    renderBank();
    await waitFor(() => expect(rowTerms()).toEqual(['garden', 'kitchen']));
    expect(screen.getByRole('button', { name: 'A2', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'A2 · 2 kelime' })).toBeInTheDocument();
    expect(screen.getByText('bahçe')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Kaynaklar' })).toHaveAttribute(
      'href',
      '/settings/kaynaklar',
    );
    expect(screen.getByRole('link', { name: 'Deste yap' })).toHaveAttribute(
      'href',
      '/decks/suggested/level-a2',
    );

    await user.click(screen.getByRole('switch', { name: 'Bildiklerimi gizle' }));
    await waitFor(() => expect(rowTerms()).toEqual(['garden', 'ticket', 'kitchen', 'village']));
    expect(screen.getByText('Biliyorum')).toBeInTheDocument();
    expect(screen.getByText('Eklendi')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'B1', pressed: false }));
    await waitFor(() => expect(rowTerms()).toEqual(['opinion']));
    // Pressing the level again shows every level.
    await user.click(screen.getByRole('button', { name: 'B1', pressed: true }));
    await waitFor(() => expect(rowTerms()).toHaveLength(6));
    expect(screen.getByRole('heading', { name: 'Tüm seviyeler · 6 kelime' })).toBeInTheDocument();
  });

  it('filters by part of speech, sorts A–Z and offers the matching suggested deck', async () => {
    await applyWordBankPage([
      row('garden', 'A2', 'bahçe', 5),
      row('suggest', 'A2', 'önermek', 4.9, 'verb'),
      row('avoid', 'A2', 'kaçınmak', 4.6, 'verb'),
      row('quickly', 'A2', 'hızlıca', 4.4, 'adverb'),
    ]);
    const user = userEvent.setup();
    renderBank();
    await waitFor(() => expect(rowTerms()).toHaveLength(4));
    const pos = screen.getByRole('group', { name: 'Kelime türü' });
    await user.click(within(pos).getByRole('button', { name: /fiil\s*2/i }));
    await waitFor(() => expect(rowTerms()).toEqual(['suggest', 'avoid']));
    expect(screen.getByRole('link', { name: 'Deste yap' })).toHaveAttribute(
      'href',
      '/decks/suggested/a2-verb',
    );
    await user.click(screen.getByRole('button', { name: 'Alfabetik' }));
    await waitFor(() => expect(rowTerms()).toEqual(['avoid', 'suggest']));
  });

  it('searches English words and Turkish meanings across levels', async () => {
    await applyWordBankPage([row('garden', 'A2', 'bahçe'), row('village', 'B2', 'köy')]);
    const user = userEvent.setup();
    renderBank();
    await screen.findByRole('list', { name: 'Kelimeler' });
    await user.type(screen.getByRole('searchbox'), 'KOY');
    await waitFor(() => expect(rowTerms()).toEqual(['village']));
    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'gard');
    await waitFor(() => expect(rowTerms()).toEqual(['garden']));
  });

  it('adds one word from its details and several with the selection bar', async () => {
    await applyWordBankPage([
      row('garden', 'A2', 'bahçe', 5),
      row('kitchen', 'A2', 'mutfak', 4.5),
      row('village', 'A2', 'köy', 4.2),
    ]);
    const user = userEvent.setup();
    renderBank();
    await screen.findByRole('list', { name: 'Kelimeler' });

    await user.click(screen.getByRole('button', { name: /^garden/, expanded: false }));
    expect(screen.getByText('I like the garden here.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'garden ekle' }));
    await waitFor(async () => expect(await noteTerms()).toEqual(['garden']));
    const note = (await db.notes.toArray())[0]!;
    const senses = await db.senses.where('note_id').equals(note.id).toArray();
    expect(senses.map((s) => s.source_sentence)).toEqual(['I like the garden here.']);
    await waitFor(() => expect(rowTerms()).toEqual(['kitchen', 'village']));

    await user.click(screen.getByRole('button', { name: 'kitchen seç' }));
    await user.click(screen.getByRole('button', { name: 'village seç' }));
    expect(screen.getByRole('button', { name: 'village seç' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const bar = screen.getByRole('region', { name: 'Seçilen kelimeler' });
    expect(within(bar).getByText('2 kelime seçildi')).toBeInTheDocument();
    expect(within(bar).getByText("Tüm kelimelerim'e eklenecek")).toBeInTheDocument();
    await user.click(within(bar).getByRole('button', { name: 'Seçilenleri ekle' }));
    await waitFor(async () => expect(await noteTerms()).toEqual(['garden', 'kitchen', 'village']));
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Seçilen kelimeler' })).toBeNull(),
    );
  });

  it('quick-adds ten words in the level mix, never above the next level', async () => {
    const rows = [
      ...Array.from({ length: 12 }, (_, i) => row(`atwo${i}`, 'A2', `iki ${i}`)),
      ...Array.from({ length: 8 }, (_, i) => row(`aone${i}`, 'A1', `bir ${i}`)),
      ...Array.from({ length: 4 }, (_, i) => row(`bone${i}`, 'B1', `üç ${i}`)),
      ...Array.from({ length: 4 }, (_, i) => row(`btwo${i}`, 'B2', `dört ${i}`)),
    ];
    await applyWordBankPage(rows);
    const user = userEvent.setup();
    renderBank();
    const quick = await screen.findByTestId('word-bank-quick');
    await user.click(within(quick).getByRole('button', { name: /10 kelime ekle/ }));
    await waitFor(async () => expect(await noteTerms()).toHaveLength(10));
    const terms = await noteTerms();
    const at = (p: string) => terms.filter((t) => t.startsWith(p)).length;
    expect(at('btwo')).toBe(0);
    expect(at('bone')).toBeLessThanOrEqual(1);
    expect(at('atwo')).toBeGreaterThanOrEqual(5);
  });

  it('explains an empty bank in plain words when there is no server to download it from', async () => {
    renderBank();
    expect(
      await screen.findByText('Kelime Bankası şu an yüklenemiyor. İnternet gelince yüklenecek.'),
    ).toBeInTheDocument();
  });

  it('the old /kelime-bankasi page sends to the bank segment', async () => {
    const { router } = renderRoute(<WordBankPage />, { path: '/kelime-bankasi' });
    await waitFor(() => expect(router.state.location.search).toBe('?tab=bank'));
    expect(router.state.location.pathname).toBe('/decks');
  });
});
