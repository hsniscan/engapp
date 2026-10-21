import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import '@/i18n';
import { SyncIndicator } from '@/app/SyncIndicator';
import { resetDb } from '@/test/db';
import { Toaster, TooltipProvider } from '@/ui';
import { AccountLinkDialog } from './AccountLinkDialog';
import { AccountPanel } from './AccountPanel';
import { AuthPage } from './AuthPage';
import { configureLink, linkAccount, resetLinkForTesting } from './link';
import { setAuthStateForTesting } from './session';
import { addNoteWithSenses, db, META, setMeta } from '@/data';
import { FakeServer } from '@/sync/testing/fakeServer';
import { SyncEngine } from '@/sync/engine';

function renderAt(element: React.ReactNode, path = '/') {
  const router = createMemoryRouter(
    [
      { path: '/', element },
      { path: '/auth', element },
    ],
    { initialEntries: [path] },
  );
  render(
    <TooltipProvider>
      <RouterProvider router={router} />
      <Toaster />
    </TooltipProvider>,
  );
  return router;
}

beforeEach(async () => {
  await resetDb();
  resetLinkForTesting();
});
afterEach(cleanup);

describe('AuthPage', () => {
  it('without backend env: says sign-in is off and guest works', () => {
    setAuthStateForTesting({ status: 'unavailable', user: null });
    renderAt(<AuthPage />, '/auth');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Kelimelerin seninle gelsin');
    expect(screen.getByText('Giriş bu sürümde kapalı')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Google/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Misafir olarak devam et' })).toBeInTheDocument();
  });

  it('guest: Google sign-in, guest option and one line on what an account gives', async () => {
    setAuthStateForTesting({ status: 'guest', user: null });
    const router = renderAt(<AuthPage />, '/auth');
    expect(screen.getByText(/senkronlanır ve metinlerden AI ile kart çıkarabilirsin/)).toBeInTheDocument();
    const google = screen.getByRole('button', { name: 'Google ile giriş yap' });
    // No backend in tests: starting the redirect fails and says so.
    await userEvent.click(google);
    expect(await screen.findByRole('alert')).toHaveTextContent('Google ile giriş başlatılamadı');
    await userEvent.click(screen.getByRole('button', { name: 'Misafir olarak devam et' }));
    expect(router.state.location.pathname).toBe('/');
  });

  it('signed in: shows the account with sign out', async () => {
    setAuthStateForTesting({
      status: 'signed_in',
      user: { id: 'u1', email: 'hasan@example.com', name: 'Hasan Basri', avatarUrl: null },
    });
    renderAt(<AuthPage />, '/auth');
    expect(screen.getByText('Hasan Basri')).toBeInTheDocument();
    expect(screen.getByText('hasan@example.com')).toBeInTheDocument();
    expect(screen.getByText('Henüz senkronlanmadı')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Çıkış yap' }));
    expect(await screen.findByRole('dialog', { name: 'Çıkış yapılsın mı?' })).toBeInTheDocument();
  });
});

describe('AccountPanel', () => {
  it('guest: explains local data and links to /auth', () => {
    setAuthStateForTesting({ status: 'guest', user: null });
    renderAt(<AccountPanel />);
    expect(screen.getByText('Misafir')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Giriş yap' })).toHaveAttribute('href', '/auth');
  });
});

describe('SyncIndicator', () => {
  it('guest mode shows a calm local state', () => {
    setAuthStateForTesting({ status: 'unavailable', user: null });
    renderAt(<SyncIndicator />);
    expect(screen.getByRole('status')).toHaveAccessibleName(/verilerin bu cihazda güvende/i);
  });
});

describe('AccountLinkDialog', () => {
  it('asks the three questions with merge preselected', async () => {
    const server = new FakeServer('u1');
    await server.pushBatch([
      {
        table: 'notes',
        op: 'upsert',
        payload: { id: 'n-remote', hlc: '000000000000001:00000:x', term: 'cope', term_norm: 'cope', deleted_at: null },
      },
    ]);
    await addNoteWithSenses({ term: 'thrive', senses: [{ meaning_tr: 'gelişmek' }] });
    configureLink({ transport: server, engine: new SyncEngine({ transport: server, getSessionUserId: async () => 'u1' }) });
    await linkAccount('u1');
    renderAt(<AccountLinkDialog />);
    const dialog = await screen.findByRole('dialog', { name: 'Bu hesapta zaten kartların var' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Birleştir/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Bu cihazdakini at/ })).not.toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: /Hesaptakini at/ }));
    expect(screen.getByRole('alert')).toHaveTextContent('geri alınamaz');
    expect(screen.getByRole('button', { name: 'Devam et' })).toBeInTheDocument();
  });

  it("another account's data: copy without history (preselected) or start with the account", async () => {
    const server = new FakeServer('u1');
    await db.transaction('rw', db.meta, () => setMeta(META.userId, 'u-other'));
    await addNoteWithSenses({ term: 'thrive', senses: [{ meaning_tr: 'gelişmek' }] });
    configureLink({ transport: server, engine: new SyncEngine({ transport: server, getSessionUserId: async () => 'u1' }) });
    await linkAccount('u1');
    renderAt(<AccountLinkDialog />);
    await screen.findByRole('dialog', { name: 'Bu cihazda başka bir hesabın kartları var' });
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(2);
    expect(screen.getByRole('radio', { name: /Kartları kopyala \(çalışma geçmişi olmadan\)/ })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: /Bu hesabın verisiyle başla/ }));
    expect(screen.queryByRole('radio', { name: /Birleştir/ })).toBeNull();
    expect(screen.queryByRole('radio', { name: /Hesaptakini at/ })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
