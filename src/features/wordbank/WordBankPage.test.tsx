import { configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { addNoteWithSenses, applyWordBankPage, db, markKnown, updateSettings } from '@/data';
import { resetDb } from '@/test/db';
import { renderRoute } from '@/test/ui';
import type { WordBankRow } from '../../../supabase/functions/_shared/wordbank-contract';
import { WordBankPage } from './WordBankPage';

// The full suite runs many jsdom files at once; give the live queries room.
configure({ asyncUtilTimeout: 5000 });

let seq = 0;
const row = (lemma: string, cefr: WordBankRow['cefr'], meaning: string, zipf = 4): WordBankRow => ({
  lemma_norm: lemma,
  pos: 'noun',
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

beforeEach(async () => {
  seq = 0;
  await resetDb();
  await updateSettings({ level: 'A2' });
});

describe('word bank screen', () => {
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
    renderRoute(<WordBankPage />, { path: '/kelime-bankasi' });
    await waitFor(() => expect(rowTerms()).toEqual(['garden', 'kitchen']));
    expect(screen.getByRole('radio', { name: 'A2' })).toBeChecked();
    expect(screen.getByText('bahçe')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Kaynaklar' })).toHaveAttribute(
      'href',
      '/settings/kaynaklar',
    );

    await user.click(screen.getByRole('switch', { name: /Bildiğim ve kartı olan/ }));
    await waitFor(() => expect(rowTerms()).toEqual(['garden', 'ticket', 'kitchen', 'village']));
    expect(screen.getByText('Biliyorum')).toBeInTheDocument();
    expect(screen.getByText('Kartın var')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'B1' }));
    await waitFor(() => expect(rowTerms()).toEqual(['opinion']));
  });

  it('searches English words and Turkish meanings across levels', async () => {
    await applyWordBankPage([row('garden', 'A2', 'bahçe'), row('village', 'B2', 'köy')]);
    const user = userEvent.setup();
    renderRoute(<WordBankPage />, { path: '/kelime-bankasi' });
    await screen.findByRole('list', { name: 'Kelimeler' });
    await user.type(screen.getByRole('searchbox'), 'KOY');
    await waitFor(() => expect(rowTerms()).toEqual(['village']));
    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'gard');
    await waitFor(() => expect(rowTerms()).toEqual(['garden']));
  });

  it('adds one word with "Ekle" and several with the selection bar', async () => {
    await applyWordBankPage([
      row('garden', 'A2', 'bahçe', 5),
      row('kitchen', 'A2', 'mutfak', 4.5),
      row('village', 'A2', 'köy', 4.2),
    ]);
    const user = userEvent.setup();
    renderRoute(<WordBankPage />, { path: '/kelime-bankasi' });
    await screen.findByRole('list', { name: 'Kelimeler' });

    await user.click(screen.getByRole('button', { name: 'garden ekle' }));
    await waitFor(async () => expect(await noteTerms()).toEqual(['garden']));
    const note = (await db.notes.toArray())[0]!;
    const senses = await db.senses.where('note_id').equals(note.id).toArray();
    expect(senses.map((s) => s.source_sentence)).toEqual(['I like the garden here.']);
    await waitFor(() => expect(rowTerms()).toEqual(['kitchen', 'village']));

    await user.click(screen.getByRole('checkbox', { name: 'kitchen seç' }));
    await user.click(screen.getByRole('checkbox', { name: 'village seç' }));
    const bar = screen.getByRole('region', { name: 'Seçilen kelimeler' });
    expect(within(bar).getByText('2 kelime seçildi')).toBeInTheDocument();
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
    renderRoute(<WordBankPage />, { path: '/kelime-bankasi' });
    const quick = await screen.findByTestId('word-bank-quick');
    await user.click(within(quick).getByRole('button', { name: /10 kelime ekle/ }));
    await waitFor(async () => expect(await noteTerms()).toHaveLength(10));
    const terms = await noteTerms();
    const at = (p: string) => terms.filter((t) => t.startsWith(p)).length;
    expect(at('btwo')).toBe(0);
    expect(at('bone')).toBeLessThanOrEqual(1);
    expect(at('atwo')).toBeGreaterThanOrEqual(5);
  });

  it('explains an empty bank when this installation has no backend', async () => {
    renderRoute(<WordBankPage />, { path: '/kelime-bankasi' });
    expect(await screen.findByText('Bu kurulumda kelime bankası yok.')).toBeInTheDocument();
  });
});
