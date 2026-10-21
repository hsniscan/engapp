import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
import { renderRoute } from '@/test/ui';
import { SettingsPage } from './SettingsPage';

beforeEach(async () => {
  await resetDb();
  localStorage.clear();
  await ensureSettings();
});

describe('settings', () => {
  it('persists study, voice and theme settings to the settings table', async () => {
    const user = userEvent.setup();
    renderRoute(<SettingsPage />, { path: '/settings' });

    await user.click(await screen.findByRole('radio', { name: 'Koyu' }));
    await waitFor(async () => expect((await getSettings()).theme).toBe('dark'));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('engapp.theme')).toBe('dark'); // pre-paint cache

    await user.click(screen.getByRole('radio', { name: 'İngiliz' }));
    await waitFor(async () => expect((await getSettings()).voice).toBe('en-GB'));

    // Sliders are keyboard operable; the value is saved once, after the last change.
    const retention = screen.getByRole('slider', { name: 'Hedef hatırlama oranı' });
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
    renderRoute(<SettingsPage />, { path: '/settings' });
    const input = await screen.findByTestId('restore-input');
    const file = new File([backup], 'engapp-yedek-2026-10-01.json', { type: 'application/json' });
    fireEvent.change(input, { target: { files: [file] } });

    const dialog = await screen.findByRole('dialog', { name: 'Yedeği geri yükle' });
    expect(within(dialog).getByTestId('restore-summary')).toHaveTextContent(
      '2 not, 5 kart, 1 tekrar',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Birleştir' }));
    await waitFor(async () => expect(await db.notes.count()).toBe(2));
    expect(await db.review_logs.count()).toBe(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('rejects a file that is not a valid backup without changing data', async () => {
    renderRoute(<SettingsPage />, { path: '/settings' });
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
    renderRoute(<SettingsPage />, { path: '/settings' });
    expect(await screen.findByText('Henüz yedek alınmadı')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Yedek al' }));
    await waitFor(() => expect(created[0]).toMatch(/^engapp-yedek-\d{4}-\d{2}-\d{2}\.json$/));
    expect(await screen.findByText('Son yedek: bugün')).toBeInTheDocument();
    click.mockRestore();
  });
});
