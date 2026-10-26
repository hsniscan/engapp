import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addNoteWithSenses,
  answerCard,
  db,
  ensureSettings,
  exportBackup,
  getSettings,
} from '@/data';
import { resetDb } from '@/test/db';
import { installDomPolyfills, renderRoute } from '@/test/ui';
import { TooltipProvider } from '@/ui';
import { SettingsIndexPage } from './SettingsIndexPage';
import { LEGACY } from './settingsPages';
import { SettingsSectionPage } from './SettingsSectionPage';

/** One settings sub-page, as the router mounts it at /settings/:section. */
const renderSection = (section: string) =>
  renderRoute(<SettingsSectionPage />, { path: '/settings/:section', url: `/settings/${section}` });

beforeEach(async () => {
  await resetDb();
  localStorage.clear();
  await ensureSettings();
});

describe('settings', () => {
  it('persists study, voice and theme settings to the settings table', async () => {
    const user = userEvent.setup();
    const appearance = renderSection('gorunum');

    await user.click(await screen.findByRole('radio', { name: 'Koyu' }));
    await waitFor(async () => expect((await getSettings()).theme).toBe('dark'));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('engapp.theme')).toBe('dark'); // pre-paint cache
    appearance.unmount();

    const cards = renderSection('kartlar');
    await user.click(await screen.findByRole('radio', { name: 'İngiliz' }));
    await waitFor(async () => expect((await getSettings()).voice).toBe('en-GB'));
    cards.unmount();

    renderSection('calisma');
    // Sliders are keyboard operable; the value is saved once, after the last change.
    const retention = await screen.findByRole('slider', { name: 'Hedef hatırlama oranı' });
    retention.focus();
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(retention).toHaveAttribute('aria-valuetext', '%92');
    await waitFor(async () => expect((await getSettings()).request_retention).toBeCloseTo(0.92), {
      timeout: 2000,
    });
    expect(screen.getByText('Çoğu kişi için iyi bir denge.')).toBeInTheDocument();

    const limit = screen.getByRole('slider', { name: 'Günlük yeni kart' });
    limit.focus();
    await user.keyboard('{ArrowLeft}');
    await waitFor(async () => expect((await getSettings()).daily_new_limit).toBe(9), {
      timeout: 2000,
    });
  });

  it('switches the new word order between smart (default) and the order added', async () => {
    const user = userEvent.setup();
    renderSection('calisma');
    const group = await screen.findByRole('group', { name: 'Yeni kelime sırası' });
    expect(within(group).getByRole('radio', { name: 'Akıllı (önerilen)' })).toBeChecked();
    await user.click(within(group).getByRole('radio', { name: 'Eklenme sırası' }));
    await waitFor(async () => expect((await getSettings()).new_card_order).toBe('added'));
    expect(await screen.findByText('Yeni kartlar eklediğin sırayla gelir.')).toBeInTheDocument();
    await user.click(within(group).getByRole('radio', { name: 'Akıllı (önerilen)' }));
    await waitFor(async () => expect((await getSettings()).new_card_order).toBe('smart'));
  });

  it('shows the zod-verified backup summary and merges it', async () => {
    const t0 = Date.UTC(2026, 9, 1, 9);
    const { createdCards } = await addNoteWithSenses(
      { term: 'bank', senses: [{ meaning_tr: 'banka' }, { meaning_tr: 'kıyı' }] },
      t0,
    );
    await addNoteWithSenses({ term: 'tide', senses: [{ meaning_tr: 'gelgit' }] }, t0);
    const rec = createdCards.find((c) => c.card_type === 'recognition')!;
    await answerCard(
      { card_id: rec.id, rating: 3, duration_ms: 4000, shown_sense_id: null },
      t0 + 60_000,
    );
    const backup = JSON.stringify(await exportBackup(t0 + 120_000));
    await resetDb();
    await ensureSettings();

    const user = userEvent.setup();
    renderSection('veri');
    const input = await screen.findByTestId('restore-input');
    const file = new File([backup], 'engapp-yedek-2026-10-01.json', { type: 'application/json' });
    fireEvent.change(input, { target: { files: [file] } });

    const dialog = await screen.findByRole('dialog', { name: 'Yedeği geri yükle' });
    expect(within(dialog).getByTestId('restore-summary')).toHaveTextContent(
      '2 not, 5 kart, 1 tekrar',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Birleştir' }));
    // The restore writes in chunks (decision 0025): check once it has finished.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await db.notes.count()).toBe(2);
    expect(await db.review_logs.count()).toBe(1);
  });

  it('"Çalışma geçmişini sıfırla" asks first, then resets every card to New', async () => {
    const { createdCards } = await addNoteWithSenses({
      term: 'tide',
      senses: [{ meaning_tr: 'gelgit' }],
    });
    const rec = createdCards.find((c) => c.card_type === 'recognition')!;
    await answerCard({ card_id: rec.id, rating: 4, duration_ms: 2000 });
    const user = userEvent.setup();
    renderSection('veri');
    await user.click(await screen.findByRole('button', { name: 'Sıfırla' }));
    const dialog = await screen.findByRole('dialog', { name: 'Çalışma geçmişi sıfırlansın mı?' });
    expect(dialog).toHaveTextContent(
      'Tüm kartların ilerlemesi ve çalışma geçmişin silinir; kartların kendisi kalır. Bu işlem geri alınamaz.',
    );
    expect(within(dialog).getByRole('button', { name: 'Vazgeç' })).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: 'Geçmişi sıfırla' }));
    await waitFor(async () => expect((await db.cards.get(rec.id))!.reps).toBe(0));
    expect(await db.notes.count()).toBe(1);
    expect(await db.daily_activity.count()).toBe(0);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('rejects a file that is not a valid backup without changing data', async () => {
    renderSection('veri');
    const input = await screen.findByTestId('restore-input');
    const toastSpy = vi.spyOn(await import('@/ui'), 'toast');
    const bad = new File(['{"format":"engapp-backup","schema_version":1}'], 'x.json', {
      type: 'application/json',
    });
    fireEvent.change(input, { target: { files: [bad] } });
    await waitFor(() => expect(toastSpy).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await db.notes.count()).toBe(0);
  });

  it('downloads a backup named engapp-yedek-YYYY-MM-DD.json and shows when it was taken', async () => {
    const user = userEvent.setup();
    const created: string[] = [];
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      created.push(this.download);
    });
    renderSection('veri');
    expect(await screen.findByText('Henüz yedek alınmadı')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Yedek al' }));
    await waitFor(() => expect(created[0]).toMatch(/^engapp-yedek-\d{4}-\d{2}-\d{2}\.json$/));
    expect(await screen.findByText('Son yedek: bugün')).toBeInTheDocument();
    click.mockRestore();
  });
});

describe('settings index and sub-pages', () => {
  /** The app's two settings routes, so links and redirects between them really navigate. */
  function renderSettings(url: string) {
    installDomPolyfills();
    const router = createMemoryRouter(
      [
        { path: '/settings', element: <SettingsIndexPage /> },
        { path: '/settings/:section', element: <SettingsSectionPage /> },
        { path: '*', element: <p>elsewhere</p> },
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

  it('lists every sub-page with its current state, and opens one', async () => {
    const user = userEvent.setup();
    const router = renderSettings('/settings');
    expect(await screen.findByRole('heading', { level: 1, name: 'Ayarlar' })).toBeInTheDocument();
    const learning = screen.getByRole('list', { name: 'Öğrenme' });
    expect(
      await within(learning).findByRole('link', { name: /Günde 10 yeni · hedef %90/ }),
    ).toHaveTextContent('Çalışma');
    for (const name of [
      'Tekrar yükü ve tatil',
      'Hatırlatmalar',
      'Seviye',
      'Kartlar ve içerik',
      'Görünüm',
      'Hesap ve eşitleme',
      'Yedek ve veri',
      'Hakkında ve yardım',
      'Gelişmiş',
    ]) {
      expect(screen.getByRole('link', { name: new RegExp(name) })).toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: /Görünüm/ })).toHaveTextContent('Sistem teması');
    await user.click(screen.getByRole('link', { name: /Yedek ve veri/ }));
    expect(router.state.location.pathname).toBe('/settings/veri');
    expect(await screen.findByRole('button', { name: 'Yedek al' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Anki dosyası/ })).toHaveAttribute(
      'href',
      '/import/anki',
    );
  });

  it('searches titles, states and keywords', async () => {
    const user = userEvent.setup();
    renderSettings('/settings');
    const box = await screen.findByRole('searchbox', { name: 'Ayarlarda ara' });
    await user.type(box, 'telaffuz');
    const results = screen.getByRole('list', { name: 'Arama sonuçları' });
    expect(within(results).getAllByRole('link')).toHaveLength(1);
    expect(within(results).getByRole('link', { name: /Kartlar ve içerik/ })).toBeInTheDocument();
    await user.clear(box);
    await user.type(box, 'zzz');
    expect(screen.getByText('“zzz” ile ilgili bir ayar bulunamadı.')).toBeInTheDocument();
  });

  it('sends old anchors and slugs to where that group lives now', async () => {
    const cases: [string, string, string][] = [
      ['/settings#veri', '/settings/veri', ''],
      ['/settings#ornekler', '/settings/kartlar', '#ornekler'],
      ['/settings#senkron', '/settings/hesap', '#senkron'],
      ['/settings#uygulama', '/settings/hakkinda', '#uygulama'],
      ['/settings/profile', '/settings/ilgi-alanlari', ''],
      ['/settings/nope', '/settings', ''],
    ];
    for (const [from, path, hash] of cases) {
      const router = renderSettings(from);
      await waitFor(() => expect(router.state.location.pathname).toBe(path));
      expect(router.state.location.hash).toBe(hash);
      cleanup();
    }
  });

  it('keeps every group of the old single page on some sub-page', async () => {
    // Each old anchor must exist as an element on the page it now points to.
    for (const [key, { page, anchor }] of Object.entries(LEGACY)) {
      if (key === 'profile' || key === 'profil') continue; // a page of its own, not a group
      renderSection(page);
      await waitFor(() => expect(document.getElementById(anchor ?? key)).not.toBeNull());
      cleanup();
    }
  });
});
