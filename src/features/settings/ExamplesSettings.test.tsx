import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { ensureSettings, getSettings } from '@/data';
import { resetDb } from '@/test/db';
import { renderRoute } from '@/test/ui';
import { ExamplesSettingsSection } from './ExamplesSettings';

beforeEach(async () => {
  await resetDb();
  await ensureSettings(Date.UTC(2026, 9, 22));
});

describe('Settings → Örnek cümleler', () => {
  it('chooses 2–4 contexts and the translation default', async () => {
    const user = userEvent.setup();
    renderRoute(<ExamplesSettingsSection />);
    const group = await screen.findByRole('group', { name: 'Hazırlanacak bağlamlar' });
    const chip = (name: string) => within(group).getByRole('button', { name });
    expect(chip('Günlük')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('Seyahat')).toHaveAttribute('aria-pressed', 'false');

    // Four chosen already: a fifth is refused.
    expect(chip('Seyahat')).toHaveAttribute('aria-disabled', 'true');
    await user.click(chip('Seyahat'));
    expect((await getSettings()).example_contexts ?? null).toBeNull();

    await user.click(chip('Resmi'));
    await waitFor(async () => expect((await getSettings()).example_contexts).toEqual(['daily', 'conversation', 'work']), { timeout: 5000 });
    await user.click(chip('Seyahat'));
    await waitFor(async () => expect((await getSettings()).example_contexts).toEqual(['daily', 'conversation', 'work', 'travel']), { timeout: 5000 });

    await user.click(chip('Günlük'));
    await user.click(chip('Sohbet'));
    await waitFor(async () => expect((await getSettings()).example_contexts).toEqual(['work', 'travel']), { timeout: 5000 });
    // Two left: they cannot be removed.
    expect(chip('İş')).toHaveAttribute('aria-disabled', 'true');

    await user.click(screen.getByRole('switch', { name: /Türkçesini hemen göster/ }));
    await waitFor(async () => expect((await getSettings()).example_tr_visible).toBe(true), { timeout: 5000 });
  });

  it('"prepare all" needs an account', async () => {
    renderRoute(<ExamplesSettingsSection />);
    expect(await screen.findByRole('button', { name: 'Tüm kartlarım için hazırla' })).toBeDisabled();
    expect(screen.getByText('Örnek cümleler Google hesabıyla çalışır.')).toBeInTheDocument();
  });
});
