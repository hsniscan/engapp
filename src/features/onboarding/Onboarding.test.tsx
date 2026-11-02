import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { addNoteWithSenses, db, ensureSettings, getMeta, getSettings } from '@/data';
import { OFFER_DISMISSED_KEY } from '@/features/leveltest/levelText';
import { HomeScreen } from '@/features/home/HomeScreen';
import { resetDb } from '@/test/db';
import { renderRoute } from '@/test/ui';
import { setAuthStateForTesting } from '@/features/auth/session';
import { finishOnboarding, setOnboardingStep } from './state';

beforeEach(async () => {
  await resetDb();
  localStorage.clear();
  await ensureSettings();
});

describe('first-run onboarding on Bugün', () => {
  it('guides a brand-new user: welcome → level (skipped) → interests → deck', async () => {
    const user = userEvent.setup();
    renderRoute(<HomeScreen />);
    const welcome = await screen.findByTestId('onboarding-welcome');
    expect(screen.getByRole('heading', { level: 1, name: 'Hoş geldin' })).toBeInTheDocument();
    // One guided path: one primary button, manual adding only as a quiet link.
    expect(within(welcome).getAllByRole('button')).toHaveLength(1);
    expect(
      screen.getByRole('button', { name: 'Kelimeleri kendim eklemek istiyorum' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'İlk kelimeni ekle' })).toBeNull();

    await user.click(within(welcome).getByRole('button', { name: 'Başlayalım' }));
    const level = await screen.findByTestId('onboarding-level');
    expect(screen.getByTestId('onboarding-step')).toHaveTextContent('Adım 1 / 3');
    expect(within(level).getByRole('button', { name: 'Teste başla' })).toBeInTheDocument();
    await user.click(within(level).getByRole('button', { name: 'Şimdi değil, atla' }));
    await waitFor(async () => expect(await getMeta(OFFER_DISMISSED_KEY)).toBe(true));

    const interests = await screen.findByTestId('onboarding-interests');
    await user.click(within(interests).getByRole('button', { name: 'Teknoloji' }));
    await user.click(within(interests).getByRole('button', { name: '1 konuyla devam et' }));
    await waitFor(async () => expect((await getSettings()).interests).toEqual(['technology']));

    // The interests question is answered, yet the flow goes on to the deck step.
    expect(await screen.findByTestId('onboarding-deck')).toBeInTheDocument();
    expect(screen.getByTestId('onboarding-step')).toHaveTextContent('Adım 3 / 3');
  });

  it('"Zaten hesabın var mı? Giriş yap" on the welcome for a guest (B3)', async () => {
    setAuthStateForTesting({ status: 'guest', user: null });
    try {
      renderRoute(<HomeScreen />);
      const welcome = await screen.findByTestId('onboarding-welcome');
      expect(within(welcome).getByTestId('onboarding-signin')).toHaveTextContent('Giriş yap');
      expect(within(welcome).getByText(/Zaten hesabın var mı/)).toBeInTheDocument();
    } finally {
      setAuthStateForTesting({ status: 'unavailable', user: null });
    }
  });

  it('offline at the deck step, "Şimdilik atla" opens the app', async () => {
    const user = userEvent.setup();
    await db.settings.update('settings', { interests: [] });
    setOnboardingStep('deck');
    renderRoute(<HomeScreen />);
    const offline = await screen.findByTestId('onboarding-deck-offline', {}, { timeout: 10_000 });
    await user.click(within(offline).getByTestId('onboarding-skip-offline'));
    await waitFor(() => expect(screen.queryByTestId('onboarding-deck')).toBeNull());
  });

  it('an existing user never sees it', async () => {
    // Interests answered on another device: synced, so this device knows the user.
    await db.settings.update('settings', { interests: [] });
    renderRoute(<HomeScreen />);
    expect(await screen.findByRole('button', { name: 'İlk kelimeni ekle' })).toBeInTheDocument();
    expect(screen.queryByTestId('onboarding-welcome')).toBeNull();
  });

  it('a user with words never sees it', async () => {
    await addNoteWithSenses({ term: 'bank', senses: [{ meaning_tr: 'banka' }] });
    renderRoute(<HomeScreen />);
    expect(await screen.findByTestId('home-words')).toBeInTheDocument();
    expect(screen.queryByTestId('onboarding-welcome')).toBeNull();
  });

  it('"kendim ekleyeceğim" ends it for good on this device', async () => {
    const user = userEvent.setup();
    renderRoute(<HomeScreen />);
    await user.click(
      await screen.findByRole('button', { name: 'Kelimeleri kendim eklemek istiyorum' }),
    );
    expect(await screen.findByRole('button', { name: 'İlk kelimeni ekle' })).toBeInTheDocument();
    expect(localStorage.getItem('engapp.onboarding')).toBe('done');
  });

  it('done: the old empty welcome', async () => {
    finishOnboarding();
    renderRoute(<HomeScreen />);
    expect(await screen.findByRole('button', { name: 'İlk kelimeni ekle' })).toBeInTheDocument();
  });
});
