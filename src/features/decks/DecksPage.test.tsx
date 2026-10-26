// Desteler screens: segments, Destelerim, Keşfet, a suggested deck and a deck's own page.
import { configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addNoteWithSenses,
  applyWordBankPage,
  createDeck,
  db,
  listDecks,
  markKnown,
  updateSettings,
} from '@/data';
import { resetDb } from '@/test/db';
import { renderRoute } from '@/test/ui';
import type { WordBankRow } from '../../../supabase/functions/_shared/wordbank-contract';
import { DeckDetailPage } from './DeckDetailPage';
import { DecksPage } from './DecksPage';
import { SuggestedDeckPage } from './SuggestedDeckPage';

configure({ asyncUtilTimeout: 5000 });

let seq = 0;
const row = (
  lemma: string,
  cefr: WordBankRow['cefr'],
  pos: WordBankRow['pos'],
  zipf: number,
  meaning = `${lemma} anlamı`,
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
      example_en: `They ${lemma} it.`,
      example_tr: 'Onu yaptılar.',
      sense_id: null,
    },
  ],
  retired: false,
  server_seq: ++seq,
});

const BANK = () => [
  row('suggest', 'A2', 'verb', 4.9, 'önermek'),
  row('avoid', 'A2', 'verb', 4.6, 'kaçınmak'),
  row('admit', 'A2', 'verb', 4.3, 'kabul etmek'),
  row('afford', 'A2', 'verb', 4.1, 'gücü yetmek'),
  row('garden', 'A2', 'noun', 5, 'bahçe'),
  row('vivid', 'B1', 'adjective', 3.9, 'canlı'),
  row('in', 'A1', 'preposition', 7.5, 'içinde'),
  row('in', 'A2', 'adverb', 7.5, 'içeri'),
];

const word = (term: string) => addNoteWithSenses({ term, senses: [{ meaning_tr: `${term} anlamı` }] });

beforeEach(async () => {
  seq = 0;
  await resetDb();
  await updateSettings({ level: 'A2' });
});

describe('DecksPage', () => {
  it('Destelerim: all words, the decks and the three segments', async () => {
    const a = await word('deadline');
    await word('colleague');
    await db.notes.update(a.note.id, { tags: ['iş'] });
    await createDeck({ name: 'İş', filter: { v: 1, tags: ['iş'] } });
    renderRoute(<DecksPage />, { path: '/decks' });

    const nav = screen.getByRole('navigation', { name: 'Deste görünümü' });
    expect(within(nav).getByRole('link', { name: 'Destelerim' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Keşfet' })).toHaveAttribute('href', '/decks?tab=discover');
    expect(within(nav).getByRole('link', { name: 'Kelime bankası' })).toHaveAttribute('href', '/decks?tab=bank');

    const all = await screen.findByRole('link', { name: /Tüm kelimelerim/ });
    expect(all).toHaveAttribute('href', '/library');
    await waitFor(() => expect(all).toHaveTextContent(/2 kelime · \d+ kart/));
    const deck = await screen.findByRole('link', { name: 'İş' });
    expect(deck.getAttribute('href')).toMatch(/^\/decks\/.+/);
    expect(screen.getByText('1 deste')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /AI ile temalara ayır/ })).toHaveAttribute('href', '/decks/themes');
  });

  it('Keşfet: a featured deck for the level, frequency, level and part-of-speech decks, "Yakında"', async () => {
    await applyWordBankPage(BANK());
    renderRoute(<DecksPage />, { path: '/decks', url: '/decks?tab=discover' });
    const hero = await screen.findByRole('region', { name: 'A2 fiiller' });
    expect(within(hero).getByText('4')).toBeInTheDocument();
    expect(within(hero).getByRole('link', { name: /Desteyi incele/ })).toHaveAttribute(
      'href',
      '/decks/suggested/a2-verb',
    );
    // Content words only: "in" (also a preposition) is not one of the most used words.
    const top = screen.getByRole('link', { name: /En çok kullanılan 100 kelime/ });
    expect(top).toHaveAttribute('href', '/decks/suggested/top-100');
    expect(screen.getByRole('link', { name: /^A2 kelimeleri/ })).toHaveAttribute('href', '/decks/suggested/level-a2');
    expect(screen.getByRole('link', { name: /^Fiiller/ })).toHaveAttribute('href', '/decks/suggested/pos-verb');
    expect(screen.getAllByText('Yakında').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Phrasal verbs')).toBeInTheDocument();
  });
});

describe('SuggestedDeckPage', () => {
  it('shows the status, adds only what is new and makes one deck', async () => {
    await applyWordBankPage(BANK());
    await word('avoid');
    await markKnown('admit', 'manual');
    const user = userEvent.setup();
    renderRoute(<SuggestedDeckPage />, { path: '/decks/suggested/:key', url: '/decks/suggested/a2-verb' });

    expect(await screen.findByRole('heading', { level: 1, name: 'A2 fiiller' })).toBeInTheDocument();
    const list = await screen.findByRole('list', { name: 'Destedeki kelimeler' });
    await waitFor(() => expect(within(list).getAllByTestId('suggested-word')).toHaveLength(4));
    expect(screen.getByRole('button', { name: 'Yeni 2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Kartında 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Biliyorsun 1' })).toBeInTheDocument();
    expect(screen.getByText('Bildiğin 1 ve kartında olan 1 kelime tekrar eklenmez.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Destemlere ekle' }));
    await waitFor(async () =>
      expect((await db.notes.toArray()).map((n) => n.term).sort()).toEqual(['afford', 'avoid', 'suggest']),
    );
    await waitFor(async () => expect(await listDecks()).toHaveLength(1));
    expect((await listDecks())[0]).toMatchObject({ name: 'A2 fiiller', filter: { v: 1, tags: ['A2 fiiller'] } });
    expect(await screen.findByRole('link', { name: /Destelerinde/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Destemlere ekle' })).toBeNull();
  });

  it('quick scan marks a word known', async () => {
    await applyWordBankPage(BANK());
    const user = userEvent.setup();
    renderRoute(<SuggestedDeckPage />, { path: '/decks/suggested/:key', url: '/decks/suggested/a2-verb' });
    await user.click(await screen.findByRole('button', { name: /Bildiklerimi işaretle/ }));
    await user.click(screen.getByRole('button', { name: 'suggest: biliyorum' }));
    await waitFor(async () =>
      expect((await db.known_terms.toArray()).map((k) => k.term_norm)).toEqual(['suggest']),
    );
  });

  it('an unknown key says so', async () => {
    renderRoute(<SuggestedDeckPage />, { path: '/decks/suggested/:key', url: '/decks/suggested/x-y-z' });
    expect(await screen.findByText('Böyle bir deste yok')).toBeInTheDocument();
  });
});

describe('DeckDetailPage', () => {
  it('a hand-picked deck: words by stage and "Kelime ekle" tags picked words', async () => {
    await word('deadline');
    await word('colleague');
    const deck = await createDeck({ name: 'Toplantı', filter: { v: 1, tags: ['Toplantı'] } });
    const user = userEvent.setup();
    renderRoute(<DeckDetailPage />, { path: '/decks/:id', url: `/decks/${deck.id}?pick=1` });

    // ?pick=1 (from "Elle seç") opens the picker at once.
    const picker = await screen.findByRole('dialog', { name: '“Toplantı” destesine kelime ekle' });
    await user.click(await within(picker).findByRole('checkbox', { name: 'deadline' }));
    await user.click(within(picker).getByRole('button', { name: '1 kelimeyi ekle' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Toplantı' })).toBeInTheDocument();
    const list = await screen.findByRole('list', { name: 'Destedeki kelimeler' });
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(1));
    expect(within(list).getByText('deadline')).toBeInTheDocument();
    expect(within(list).getByText('Yeni')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yeni 1' })).toBeInTheDocument();
  });

  it('a missing deck', async () => {
    renderRoute(<DeckDetailPage />, { path: '/decks/:id', url: '/decks/nope' });
    expect(await screen.findByText('Deste bulunamadı')).toBeInTheDocument();
  });
});
