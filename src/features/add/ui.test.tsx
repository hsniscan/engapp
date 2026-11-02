import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { installDomPolyfills } from '@/test/ui';
import { closeAddSheet, useAddSheetOpen } from './addSheetStore';
import { AddFlowPage } from './ui';

afterEach(() => closeAddSheet());

function SheetFlag() {
  return <p data-testid="sheet">{useAddSheetOpen() ? 'open' : 'closed'}</p>;
}

function renderAt(entries: string[]) {
  installDomPolyfills();
  const router = createMemoryRouter(
    [
      { path: '/', element: <SheetFlag /> },
      { path: '/decks', element: <SheetFlag /> },
      {
        path: '/makale',
        element: (
          <AddFlowPage title="Bağlantıdan makale">
            <SheetFlag />
          </AddFlowPage>
        ),
      },
    ],
    { initialEntries: entries, initialIndex: entries.length - 1 },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe('AddFlowPage (v0.5.2, ADR 0068)', () => {
  it('"‹ Ekle" goes back to the screen the sheet was opened on and opens the sheet again', async () => {
    const router = renderAt(['/decks']);
    await act(() => router.navigate('/makale'));
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      'Bağlantıdan makale',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ekle' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/decks'));
    await waitFor(() => expect(screen.getByTestId('sheet')).toHaveTextContent('open'));
  });

  it('on a cold start (nothing to go back to) it opens the sheet over Bugün', async () => {
    const router = renderAt(['/makale']);
    fireEvent.click(screen.getByRole('button', { name: 'Ekle' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    await waitFor(() => expect(screen.getByTestId('sheet')).toHaveTextContent('open'));
  });

  it('a sub-step links to its parent page instead', () => {
    installDomPolyfills();
    const router = createMemoryRouter(
      [
        {
          path: '/import/x',
          element: <AddFlowPage title="Önizleme" back={{ to: '/import', label: 'İşler' }} />,
        },
      ],
      { initialEntries: ['/import/x'] },
    );
    render(<RouterProvider router={router} />);
    expect(screen.getByRole('link', { name: 'İşler' })).toHaveAttribute('href', '/import');
    expect(screen.queryByRole('button', { name: 'Ekle' })).toBeNull();
  });
});
