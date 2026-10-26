import { fireEvent, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { installDomPolyfills } from '@/test/ui';
import { AppShell, TooltipProvider } from '@/ui';
import { AddSheet } from './AddSheet';
import { closeAddSheet, openAddSheet, quickAddHref, useAddSheetOpen } from './addSheetStore';

afterEach(() => closeAddSheet());

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

describe('Add sheet', () => {
  it('opens from the raised (+) of the tab bar, not a page', () => {
    renderShell();
    const plus = screen.getByTestId('nav-add');
    expect(plus).toHaveAccessibleName('Ekle');
    expect(plus).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(plus);
    const sheet = screen.getByRole('dialog', { name: 'Ne eklemek istersin?' });
    expect(within(sheet).getByTestId('add-way-word')).toHaveAttribute('href', '/add');
    expect(within(sheet).getByTestId('add-way-text')).toHaveAttribute('href', '/add?tab=paste');
    expect(within(sheet).getByTestId('add-way-bank')).toHaveAttribute('href', '/decks?tab=bank');
    expect(within(sheet).getByTestId('add-way-decks')).toHaveAttribute(
      'href',
      '/decks?tab=discover',
    );
    expect(within(sheet).getByTestId('add-way-anki')).toHaveAttribute('href', '/import/anki');
    expect(within(sheet).getByTestId('add-way-article')).toHaveAttribute('href', '/makale');
    expect(within(sheet).getByTestId('add-way-subtitle')).toHaveAttribute('href', '/altyazi');
  });

  it('quick add goes to the add form with the word filled in, and closes', async () => {
    const router = renderShell();
    fireEvent.click(screen.getByTestId('nav-add'));
    fireEvent.change(screen.getByLabelText('Hızlı ekle · anlamı ve örnekleri AI bulur'), {
      target: { value: '  serendipity ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Kelimeyi ekle' }));
    await screen.findByText('home');
    expect(router.state.location.pathname + router.state.location.search).toBe(
      '/add?term=serendipity',
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('an empty quick add stays in the sheet', () => {
    renderShell();
    fireEvent.click(screen.getByTestId('nav-add'));
    fireEvent.click(screen.getByRole('button', { name: 'Kelimeyi ekle' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('builds the quick-add address', () => {
    expect(quickAddHref(' run out ')).toBe('/add?term=run%20out');
    expect(quickAddHref('   ')).toBe('/add');
  });
});

describe('tab bar', () => {
  it('marks Profil for the settings pages and Desteler for the word list', () => {
    renderShell('/settings/calisma');
    const nav = screen.getAllByRole('navigation', { name: 'Ana gezinme' })[1]!;
    expect(within(nav).getByRole('link', { name: 'Profil' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Bugün' })).not.toHaveAttribute('aria-current');
  });
});
