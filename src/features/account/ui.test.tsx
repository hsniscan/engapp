import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@/i18n';
import { addNoteWithSenses, db } from '@/data';
import { setAuthStateForTesting } from '@/features/auth/session';
import { DeleteAccountPage } from '@/features/legal/DeleteAccountPage';
import { PrivacyPage } from '@/features/legal/PrivacyPage';
import { resetDb } from '@/test/db';
import { Toaster, TooltipProvider } from '@/ui';
import { AccountDeleteRow } from './AccountDeleteRow';
import { DeleteDialog } from './DeleteDialog';
import type { DeletionDeps } from './deletion';

function renderAt(element: React.ReactNode, path = '/') {
  const router = createMemoryRouter([{ path: '*', element }], { initialEntries: [path] });
  render(
    <TooltipProvider>
      <RouterProvider router={router} />
      <Toaster />
    </TooltipProvider>,
  );
  return router;
}

const USER = {
  id: '0199f0a0-0000-7000-8000-00000000d201',
  email: 'hasan@example.com',
  name: 'Hasan Test',
  avatarUrl: null,
};

function fakeDeps(over: Partial<DeletionDeps> = {}): DeletionDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    config: { url: 'https://example.supabase.co', key: 'k' },
    getAccessToken: async () => 'tok',
    getUserId: async () => USER.id,
    fetch: (async () => {
      calls.push('server');
      return new Response(
        JSON.stringify({ deleted: true, account: 'deleted', rows: {}, files: 0 }),
        { status: 200 },
      );
    }) as unknown as typeof fetch,
    wipeDevice: async () => {
      calls.push('wipe');
    },
    signOut: async () => {
      calls.push('signOut');
    },
    ...over,
  };
}

beforeEach(async () => {
  await resetDb();
});
afterEach(cleanup);

describe('DeleteDialog (account)', () => {
  it('lists what is deleted, offers a backup and needs the typed word', async () => {
    const user = userEvent.setup();
    const deps = fakeDeps();
    const onDone = vi.fn();
    renderAt(
      <DeleteDialog open onOpenChange={() => {}} mode="account" deps={deps} onDone={onDone} />,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Hesabın ve verilerin silinsin mi?' });
    for (const text of [
      /Kartların, kelimelerin/,
      /Çalışma geçmişin/,
      /Ayarların/,
      /Haftalık raporların/,
      /Görsel isteklerin/,
      /Bildirim kayıtların/,
    ])
      expect(within(dialog).getByText(text)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'JSON yedeğini indir' })).toBeInTheDocument();

    const confirm = within(dialog).getByRole('button', { name: 'Hesabımı kalıcı olarak sil' });
    expect(confirm).toBeDisabled();
    const field = within(dialog).getByLabelText('Onaylamak için SİL yaz');
    await user.type(field, 'SI');
    expect(confirm).toBeDisabled();
    await user.type(field, 'L');
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('/hesap-sil?durum=silindi'));
    expect(deps.calls).toEqual(['server', 'wipe', 'signOut']);
  });

  it('offline: says nothing was deleted and keeps the device data', async () => {
    const user = userEvent.setup();
    const deps = fakeDeps({
      fetch: (async () => {
        throw new TypeError('Failed to fetch');
      }) as unknown as typeof fetch,
    });
    const onDone = vi.fn();
    renderAt(
      <DeleteDialog open onOpenChange={() => {}} mode="account" deps={deps} onDone={onDone} />,
    );
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Onaylamak için SİL yaz'), 'sil');
    await user.click(within(dialog).getByRole('button', { name: 'Hesabımı kalıcı olarak sil' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'İnternet bağlantısı yok. Bağlanınca tekrar dene; hiçbir şey silinmedi.',
    );
    expect(deps.calls).toEqual([]);
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe('DeleteDialog (device)', () => {
  it('wipes only this device and goes to the confirmation page', async () => {
    const user = userEvent.setup();
    const deps = fakeDeps();
    const onDone = vi.fn();
    renderAt(<DeleteDialog open onOpenChange={() => {}} mode="device" deps={deps} onDone={onDone} />);
    const dialog = await screen.findByRole('dialog', { name: 'Bu cihazdaki veriler silinsin mi?' });
    await user.type(within(dialog).getByLabelText('Onaylamak için SİL yaz'), 'SİL');
    await user.click(within(dialog).getByRole('button', { name: 'Bu cihazdaki verileri sil' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('/hesap-sil?durum=cihaz'));
    expect(deps.calls).toEqual(['wipe']);
  });

  it('with the real wipe, the local database is empty afterwards', async () => {
    const user = userEvent.setup();
    await addNoteWithSenses({ term: 'thrive', senses: [{ meaning_tr: 'gelişmek' }] });
    const onDone = vi.fn();
    renderAt(<DeleteDialog open onOpenChange={() => {}} mode="device" onDone={onDone} />);
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Onaylamak için SİL yaz'), 'sil');
    await user.click(within(dialog).getByRole('button', { name: 'Bu cihazdaki verileri sil' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(await db.notes.count()).toBe(0);
    expect(await db.cards.count()).toBe(0);
  });
});

describe('AccountDeleteRow', () => {
  it('signed in: "Hesabımı ve verilerimi sil" opens the account dialog', async () => {
    const user = userEvent.setup();
    setAuthStateForTesting({ status: 'signed_in', user: USER });
    renderAt(<AccountDeleteRow />);
    expect(screen.getByText('Hesabımı ve verilerimi sil')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Hesabı sil' }));
    expect(
      await screen.findByRole('dialog', { name: 'Hesabın ve verilerin silinsin mi?' }),
    ).toBeInTheDocument();
  });

  it('guest: "Bu cihazdaki verileri sil" (local only)', async () => {
    const user = userEvent.setup();
    setAuthStateForTesting({ status: 'guest', user: null });
    renderAt(<AccountDeleteRow />);
    expect(screen.getByText('Bu cihazdaki verileri sil')).toBeInTheDocument();
    expect(screen.getByText(/Misafir modunda sunucuda verin yok/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Verileri sil' }));
    expect(
      await screen.findByRole('dialog', { name: 'Bu cihazdaki veriler silinsin mi?' }),
    ).toBeInTheDocument();
  });
});

describe('public pages', () => {
  it('/gizlilik: Turkish policy with every section, KVKK rights and the processors', () => {
    renderAt(<PrivacyPage lang="tr" />, '/gizlilik');
    expect(screen.getByRole('heading', { level: 1, name: 'Gizlilik politikası' })).toBeInTheDocument();
    for (const h of [
      'Veri sorumlusu ve iletişim',
      'Hangi verileri işliyoruz',
      'Nerede işleniyor, kimlerle paylaşılıyor',
      'Ne kadar saklıyoruz',
      'Hesabını ve verilerini silme',
      'Haklarına (KVKK m. 11)',
      'Çocuklar',
      'Değişiklikler',
    ])
      expect(screen.getByRole('heading', { level: 2, name: new RegExp(h.replace(/[()]/g, '\\$&')) })).toBeInTheDocument();
    for (const name of ['Supabase', 'Cloudflare', 'Google Gemini', 'Anthropic Claude'])
      expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    // No VITE_CONTACT_EMAIL in tests: a visible placeholder, never a made-up address.
    expect(screen.getAllByText('(iletişim adresi henüz eklenmedi)').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'hesap silme sayfası' })[0]).toHaveAttribute(
      'href',
      '/hesap-sil',
    );
  });

  it('/privacy: English version, lang="en"', () => {
    renderAt(<PrivacyPage lang="en" />, '/privacy');
    expect(screen.getByRole('heading', { level: 1, name: 'Privacy policy' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /Your rights \(KVKK art. 11\)/ })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('en');
    expect(screen.getAllByRole('link', { name: 'Back to the app' })[0]).toHaveAttribute('href', '/');
  });

  it('/hesap-sil signed out: explains and offers Google sign-in', () => {
    setAuthStateForTesting({ status: 'guest', user: null });
    renderAt(<DeleteAccountPage />, '/hesap-sil');
    expect(
      screen.getByRole('heading', { level: 1, name: 'Hesabını ve verilerini sil' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Google ile giriş yap' })).toBeInTheDocument();
    expect(screen.getByText(/Ayarlar → Hesap → Hesabımı ve verilerimi sil/)).toBeInTheDocument();
  });

  it('/hesap-sil signed in: shows the account and the delete button', async () => {
    const user = userEvent.setup();
    setAuthStateForTesting({ status: 'signed_in', user: USER });
    renderAt(<DeleteAccountPage />, '/hesap-sil');
    expect(screen.getByText('Hasan Test')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Hesabımı ve verilerimi sil' }));
    const dialog = await screen.findByRole('dialog', { name: 'Hesabın ve verilerin silinsin mi?' });
    // On the web page the local backup is not offered (this browser may hold nothing).
    expect(within(dialog).queryByRole('button', { name: 'JSON yedeğini indir' })).toBeNull();
  });

  it('/hesap-sil?durum=silindi: the confirmation', () => {
    renderAt(<DeleteAccountPage />, '/hesap-sil?durum=silindi');
    expect(screen.getByRole('heading', { name: 'Hesabın ve verilerin silindi' })).toBeInTheDocument();
  });
});
