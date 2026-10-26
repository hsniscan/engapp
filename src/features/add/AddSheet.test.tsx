import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WordBankRow } from '../../../supabase/functions/_shared/wordbank-contract';
import { addNoteWithSenses, db, findNoteByTerm } from '@/data';
import { entryFromRow } from '@/domain/wordBank';
import { setAuthStateForTesting } from '@/features/auth/session';
import { resetDb } from '@/test/db';
import { installDomPolyfills } from '@/test/ui';
import { AppShell, TooltipProvider } from '@/ui';
import { AddSheet } from './AddSheet';
import { closeAddSheet, openAddSheet, quickAddHref, useAddSheetOpen } from './addSheetStore';

beforeEach(async () => {
  await resetDb();
  setAuthStateForTesting({ status: 'guest', user: null });
});
afterEach(() => closeAddSheet());

const SID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const bankRow: WordBankRow = {
  lemma_norm: 'postpone',
  pos: 'verb',
  lemma: 'postpone',
  cefr: 'B2',
  list_source: 'cefrj',
  zipf: 3.4,
  lexicon_term_id: SID(1),
  senses: [
    {
      meaning_tr: 'ertelemek',
      example_en: 'They postponed the meeting.',
      example_tr: 'Toplantıyı ertelediler.',
      sense_id: SID(11),
    },
  ],
  retired: false,
  server_seq: 1,
};

function Shell() {
  const open = useAddSheetOpen();
  return (
    <>
      <AppShell onAdd={openAddSheet} addOpen={open}>
        <p>home</p>
      </AppShell>
      <AddSheet />
    </>
  );
}

function renderShell(url = '/') {
  installDomPolyfills();
  const router = createMemoryRouter(
    [
      { path: '/', element: <Shell /> },
      { path: '*', element: <Shell /> },
    ],
    { initialEntries: [url] },
  );
  render(
    <TooltipProvider>
      <RouterProvider router={router} />
    </TooltipProvider>,
  );
  return router;
}

const sheet = () => screen.getByRole('dialog', { name: 'Ne eklemek istersin?' });

describe('Add sheet (v0.5.1): four groups', () => {
  it('opens from the raised (+): Kelime ekle · Metin ekle · Kelimelerimle metin · İçe aktar', () => {
    renderShell();
    const plus = screen.getByTestId('nav-add');
    expect(plus).toHaveAccessibleName('Ekle');
    fireEvent.click(plus);
    const s = sheet();
    expect(
      within(s)
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent),
    ).toEqual(['Kelime ekle', 'Metin ekle', 'Kelimelerimle metin', 'İçe aktar']);
    const href = (id: string) => within(s).getByTestId(id).getAttribute('href');
    expect(href('add-way-word')).toBe('/add');
    expect(href('add-way-text')).toBe('/add?tab=paste');
    expect(href('add-way-pdf')).toBe('/add?tab=pdf');
    expect(href('add-way-article')).toBe('/makale');
    expect(href('add-way-photo')).toBe('/fotograf');
    expect(href('add-way-subtitle')).toBe('/altyazi');
    expect(href('add-way-compose')).toBe('/metin-olustur');
    expect(href('add-way-anki')).toBe('/import/anki');
    expect(href('add-way-csv')).toBe('/import/csv');
    expect(href('add-way-backup')).toBe('/settings/veri');
    // Ready-made decks and the word bank live in Keşfet / Kelimelerim now; no duplicate row.
    expect(within(s).queryByTestId('add-way-bank')).toBeNull();
    expect(within(s).queryByTestId('add-way-decks')).toBeNull();
    expect(within(s).queryByText('Kelime yaz')).toBeNull();
  });

  it('a word from Kelime Bankası is looked up in the sheet and becomes a card there', async () => {
    await db.word_bank.put(entryFromRow(bankRow));
    renderShell();
    fireEvent.click(screen.getByTestId('nav-add'));
    fireEvent.change(screen.getByTestId('add-word-input'), { target: { value: ' postponed ' } });
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Anlamını bul' }));
    expect(await within(sheet()).findByText('ertelemek')).toBeInTheDocument();
    // The long form stays one tap away, with the dictionary form filled in.
    expect(within(sheet()).getByTestId('add-word-manual')).toHaveAttribute(
      'href',
      '/add?term=postpone',
    );
    fireEvent.click(within(sheet()).getByTestId('add-word-save'));
    expect(await within(sheet()).findByTestId('add-word-saved')).toHaveTextContent(
      '“postpone” kartlarına eklendi',
    );
    const found = await findNoteByTerm('postpone');
    expect(found?.senses.map((x) => x.meaning_tr)).toEqual(['ertelemek']);
  });

  it('a guest’s unknown word: an honest line, and the hand-written form', async () => {
    renderShell();
    fireEvent.click(screen.getByTestId('nav-add'));
    fireEvent.change(screen.getByTestId('add-word-input'), { target: { value: 'zyzzyva' } });
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Anlamını bul' }));
    expect(
      await within(sheet()).findByText(/Yapay zekânın anlamını bulması için giriş yap/),
    ).toBeInTheDocument();
    expect(within(sheet()).getByTestId('add-word-manual')).toHaveAttribute(
      'href',
      '/add?term=zyzzyva',
    );
  });

  it('a word already on the user’s cards shows its meaning, no sign-in line', async () => {
    await addNoteWithSenses({ term: 'zyzzyva', senses: [{ meaning_tr: 'bir böcek' }] });
    renderShell();
    fireEvent.click(screen.getByTestId('nav-add'));
    fireEvent.change(screen.getByTestId('add-word-input'), { target: { value: 'zyzzyva' } });
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Anlamını bul' }));
    expect(await within(sheet()).findByTestId('quick-mine')).toHaveTextContent('bir böcek');
    expect(within(sheet()).queryByText(/giriş yap/)).toBeNull();
  });

  it('an empty word stays in the sheet', () => {
    renderShell();
    fireEvent.click(screen.getByTestId('nav-add'));
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Anlamını bul' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByTestId('add-word-result')).toBeNull();
  });

  it('openAddSheet(section) brings that group into view; a click event opens it at the top', async () => {
    const scrolled: string[] = [];
    const spy = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function (
      this: HTMLElement,
    ) {
      scrolled.push(this.dataset.testid ?? '');
    });
    try {
      renderShell();
      act(() => openAddSheet('import'));
      await waitFor(() => expect(scrolled).toContain('add-sheet-import'));
      act(() => closeAddSheet());
      act(() => openAddSheet({ type: 'click' }));
      expect(sheet()).toBeInTheDocument();
      act(() => closeAddSheet());
      act(() => openAddSheet('word'));
      await waitFor(() => expect(screen.getByTestId('add-word-input')).toHaveFocus());
    } finally {
      spy.mockRestore();
    }
  });

  it('builds the hand-written form’s address', () => {
    expect(quickAddHref(' run out ')).toBe('/add?term=run%20out');
    expect(quickAddHref('   ')).toBe('/add');
  });
});

describe('tab bar', () => {
  it('marks Profil for the settings pages', () => {
    renderShell('/settings/calisma');
    const nav = screen.getAllByRole('navigation', { name: 'Ana gezinme' })[1]!;
    expect(within(nav).getByRole('link', { name: 'Profil' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Bugün' })).not.toHaveAttribute('aria-current');
  });

  it('on a (+) page no tab is current; the (+) is', () => {
    installDomPolyfills();
    const router = createMemoryRouter([{ path: '*', element: <AppShell addSection>x</AppShell> }], {
      initialEntries: ['/decks'],
    });
    render(
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>,
    );
    const nav = screen.getAllByRole('navigation', { name: 'Ana gezinme' })[1]!;
    expect(within(nav).queryByRole('link', { current: 'page' })).toBeNull();
    expect(within(nav).getByTestId('nav-add')).toHaveAttribute('aria-current', 'page');
  });
});
