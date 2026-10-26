import { expect, test } from './support/app.ts';
import { serveWordBank, type BankRowSeed } from './support/wordBankSeed.ts';

// v0.5.1 first run (ADR 0058): a brand-new guest gets one guided path, welcome → level test
// (skipped here; level-test.spec.ts covers the test) → interests → a ready deck → the first
// session. Asserts what the user sees, then that a reload never shows the onboarding again.

test.use({ firstRun: true });

const row = (i: number, lemma: string, pos: string, cefr: string, zipf: number): BankRowSeed => ({
  lemma_norm: lemma,
  pos,
  lemma,
  cefr,
  list_source: 'cefrj',
  zipf,
  lexicon_term_id: null,
  senses: [
    {
      meaning_tr: `${lemma} anlamı`,
      example_en: `We talked about ${lemma} yesterday.`,
      example_tr: `Dün ${lemma} hakkında konuştuk.`,
      sense_id: null,
    },
  ],
  retired: false,
  server_seq: i + 1,
});

const BANK: BankRowSeed[] = [
  ...['time', 'people', 'year', 'world', 'life', 'house', 'water', 'money'].map((w, i) =>
    row(i, w, 'noun', 'A1', 6.5 - i / 10),
  ),
  ...['make', 'know', 'think', 'decide', 'manage', 'improve'].map((w, i) =>
    row(20 + i, w, 'verb', 'B1', 6 - i / 10),
  ),
];

test('first run: a brand-new guest is guided from welcome to the first session', async ({
  page,
}) => {
  await serveWordBank(page, BANK);
  await page.goto('/');

  // 1. Welcome: one primary action; adding by hand is a secondary link.
  const welcome = page.getByTestId('onboarding-welcome');
  await expect(page.getByRole('heading', { level: 1, name: 'Hoş geldin' })).toBeVisible();
  await expect(
    welcome.getByRole('heading', { name: 'Kelimeleri kalıcı öğrenmeye başlayalım' }),
  ).toBeVisible();
  await expect(welcome.getByRole('button')).toHaveCount(1);
  await expect(
    page.getByRole('button', { name: 'Kelimeleri kendim eklemek istiyorum' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'İlk kelimeni ekle' })).toHaveCount(0);
  await welcome.getByRole('button', { name: 'Başlayalım' }).click();

  // 2. Level test, skippable.
  const level = page.getByTestId('onboarding-level');
  await expect(level.getByRole('heading', { name: 'Seviyeni ölçelim' })).toBeVisible();
  await expect(page.getByTestId('onboarding-step')).toHaveText('Adım 1 / 3');
  await level.getByRole('button', { name: 'Şimdi değil, atla' }).click();

  // 3. Interests (moved here from the home prompt).
  const interests = page.getByTestId('onboarding-interests');
  await expect(
    interests.getByRole('heading', { name: 'Hangi konular ilgini çekiyor?' }),
  ).toBeVisible();
  await interests.getByRole('button', { name: 'Seyahat' }).click();
  await interests.getByRole('button', { name: '1 konuyla devam et' }).click();

  // 4. A ready deck, then straight into the first session.
  const deck = page.getByTestId('onboarding-deck');
  await expect(deck.getByRole('heading', { name: 'Hazır bir desteyle başla' })).toBeVisible();
  const top500 = deck.getByRole('radio', { name: /En çok kullanılan 500 kelime/ });
  await expect(top500).toBeChecked();
  await deck.getByRole('radio', { name: /En çok kullanılan 100 kelime/ }).check();
  await deck.getByRole('button', { name: 'Bu desteyle ilk çalışmaya başla' }).click();

  await expect(page).toHaveURL(/\/study\?mode=word$/, { timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Cevabı göster' })).toBeVisible();

  // Back on Bugün: the dashboard, never the onboarding again (also after a reload).
  await page.goto('/');
  await expect(page.getByTestId('start-study')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('start-study')).toBeVisible();
  await expect(page.getByTestId('onboarding-welcome')).toHaveCount(0);
  // The interests question was answered in the flow: no second prompt on the home screen.
  await expect(page.getByRole('region', { name: 'Hangi konular ilgini çekiyor?' })).toHaveCount(0);
});

test('first run: "kendim ekleyeceğim" opens the add sheet and ends the onboarding', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Kelimeleri kendim eklemek istiyorum' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'İlk kelimeni ekle' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'İlk kelimeni ekle' })).toBeVisible();
});
