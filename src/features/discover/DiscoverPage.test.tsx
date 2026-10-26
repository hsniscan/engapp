// Keşfet (v0.5.1): the feed, its filters, the deck catalogue and the offline note, as the user
// sees them.
import { configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyWordBankPage, db, saveText, updateSettings } from '@/data';
import { resetDb } from '@/test/db';
import { renderRoute } from '@/test/ui';
import type { WordBankRow } from '../../../supabase/functions/_shared/wordbank-contract';
import { DiscoverPage } from './DiscoverPage';

configure({ asyncUtilTimeout: 8000 });

let seq = 0;
const row = (lemma: string, cefr: WordBankRow['cefr'], pos: WordBankRow['pos'], zipf: number, meaning = `${lemma} anlamı`): WordBankRow => ({
  lemma_norm: lemma,
  pos,
  lemma,
  cefr,
  list_source: 'cefrj',
  zipf,
  lexicon_term_id: null,
  senses: [{ meaning_tr: meaning, example_en: `They ${lemma} it.`, example_tr: 'Onu yaptılar.', sense_id: null }],
  retired: false,
  server_seq: ++seq,
});

const BANK = () => [
  row('suggest', 'A2', 'verb', 4.9, 'önermek'),
  row('avoid', 'A2', 'verb', 4.6, 'kaçınmak'),
  row('admit', 'A2', 'verb', 4.3, 'kabul etmek'),
  row('afford', 'A2', 'verb', 4.1, 'gücü yetmek'),
  row('garden', 'A2', 'noun', 5, 'bahçe'),
  row('village', 'A2', 'noun', 4.4, 'köy'),
  // "go" is in the lists as a verb and as a noun: never an example of nouns.
  row('go', 'A1', 'verb', 6.5, 'gitmek'),
  row('go', 'A2', 'noun', 6.5, 'deneme'),
  row('vivid', 'B1', 'adjective', 3.9, 'canlı'),
];

const open = (url: string) => renderRoute(<DiscoverPage />, { path: '/kesfet', url });

beforeEach(async () => {
  seq = 0;
  await resetDb();
  await updateSettings({ level: 'A2' });
});

describe('Keşfet', () => {
  it('Hepsi: the text left unfinished first, then a deck and the word of the day; no "Yakında"', async () => {
    await applyWordBankPage(BANK());
    await saveText({ kind: 'paste', title: 'A walk in the park', body: 'One. Two. Three.' });
    open('/kesfet');

    expect(screen.getByRole('heading', { level: 1, name: 'Keşfet' })).toBeInTheDocument();
    const chips = screen.getByRole('navigation', { name: 'Keşfet süzgeci' });
    expect(within(chips).getAllByRole('link').map((l) => l.textContent)).toEqual([
      'Hepsi',
      'Okuma',
      'Desteler',
      'Kelimeler',
    ]);
    expect(within(chips).getByRole('link', { name: 'Hepsi' })).toHaveAttribute('aria-current', 'page');
    expect(within(chips).getByRole('link', { name: 'Okuma' })).toHaveAttribute('href', '/kesfet?f=okuma');

    const cont = await screen.findByTestId('kesfet-continue');
    expect(within(cont).getByText('A walk in the park')).toBeInTheDocument();
    expect(within(cont).getByRole('link', { name: /Kaldığın yerden oku/ })).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/oku\//),
    );
    // The feed opens with it.
    const regions = screen.getAllByRole('region');
    expect(regions[0]).toBe(cont);

    expect(await screen.findByRole('region', { name: 'A2 fiiller' })).toBeInTheDocument();
    const word = await screen.findByTestId('kesfet-word');
    expect(within(word).getByRole('heading', { name: /Günün kelimesi/ })).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: /Günün yanıltıcı benzeri/ })).toBeInTheDocument();
    expect(screen.queryByText(/Yakında/)).toBeNull();
  });

  it('Kelimeler: the word of the day goes into the cards with one tap', async () => {
    await applyWordBankPage(BANK());
    const user = userEvent.setup();
    open('/kesfet?f=kelimeler');
    const word = await screen.findByTestId('kesfet-word');
    const lemma = within(word).getByText((_, el) => el?.tagName === 'P' && el.getAttribute('lang') === 'en' && !!el.textContent && !el.textContent.includes(' ')).textContent!;
    await user.click(within(word).getByRole('button', { name: 'Kartlarıma ekle' }));
    expect(await within(word).findByText('Kartlarına eklendi')).toBeInTheDocument();
    // The card keeps the word it showed; the note is in the collection.
    expect(within(word).getByText(lemma)).toBeInTheDocument();
    await waitFor(async () => expect((await db.notes.toArray()).map((n) => n.term)).toContain(lemma));
    // Only word cards under this filter.
    expect(screen.queryByRole('region', { name: 'A2 fiiller' })).toBeNull();
    expect(screen.getByRole('list', { name: 'Yeni kelimeler' })).toBeInTheDocument();
  });

  it('Desteler: every suggested deck, ambiguous words left out of the examples', async () => {
    await applyWordBankPage(BANK());
    open('/kesfet?f=desteler');
    expect(await screen.findByRole('region', { name: 'A2 fiiller' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /En çok kullanılan 100 kelime/ })).toHaveAttribute(
      'href',
      '/decks/suggested/top-100',
    );
    expect(screen.getByRole('link', { name: /^A2 kelimeleri/ })).toHaveAttribute('href', '/decks/suggested/level-a2');
    const nouns = screen.getByRole('link', { name: /^İsimler/ });
    expect(nouns).toHaveAttribute('href', '/decks/suggested/pos-noun');
    expect(nouns.textContent).not.toMatch(/\bgo\b/);
    expect(screen.queryByText(/Yakında/)).toBeNull();
    expect(screen.queryByText('Phrasal verbs')).toBeNull();
  });

  it('Okuma: the reading cards, then Metinlerim and the library', async () => {
    await saveText({ kind: 'paste', title: 'Morning notes', body: 'Hello there.' });
    open('/kesfet?f=okuma');
    expect(await screen.findByTestId('kesfet-continue')).toBeInTheDocument();
    const mine = await screen.findByTestId('my-texts');
    expect(within(mine).getByText('Morning notes')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /Günün kelimesi/ })).toBeNull();
  });

  it('without the downloads: a friendly note with "Tekrar dene", no developer words', async () => {
    open('/kesfet');
    expect(await screen.findByTestId('kesfet-missing')).toHaveTextContent(
      'Bazı öneriler internet gelince yüklenecek',
    );
    expect(screen.getByRole('button', { name: 'Tekrar dene' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/kurulum/i);
  });
});
