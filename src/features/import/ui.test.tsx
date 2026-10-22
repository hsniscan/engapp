import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import '@/i18n';
import { db, getImportJob, setKnownTermsProvider, type ImportJobRecord } from '@/data';
import { setAuthStateForTesting } from '@/features/auth/session';
import { resetDb } from '@/test/db';
import { Toaster, TooltipProvider } from '@/ui';
import { ImportPreviewPage } from './ImportPreviewPage';
import { PdfImportPanel } from './PdfImportPanel';
import { TextImportPanel } from './TextImportPanel';
import { FAKE_SPECS, seedReadyJob } from './testing/fakeData';

function renderAt(path: string, routes: { path: string; element: React.ReactNode }[]) {
  const router = createMemoryRouter(
    [
      ...routes,
      { path: '/library', element: <p>library page</p> },
      { path: '/add', element: <p>add page</p> },
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

const signedIn = () =>
  setAuthStateForTesting({
    status: 'signed_in',
    user: { id: 'u1', email: 'h@example.com', name: 'Hasan', avatarUrl: null },
  });

beforeEach(async () => {
  await resetDb();
  signedIn();
});
afterEach(() => {
  cleanup();
  setKnownTermsProvider(null);
});

/** The preview row whose headword is `term`. */
const row = (items: HTMLElement[], term: string) =>
  items.find((li) => li.querySelector('span[lang="en"]')?.textContent === term)!;

describe('import panels', () => {
  it('guests see a calm sign-in prompt and the privacy note', () => {
    setAuthStateForTesting({ status: 'guest', user: null });
    renderAt('/', [{ path: '/', element: <TextImportPanel /> }]);
    expect(screen.getByText('Gizli iş belgelerini yükleme.')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /AI ile kart çıkarmak için giriş yap/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Google ile giriş yap/ })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('without a backend the panels say AI is off', () => {
    setAuthStateForTesting({ status: 'unavailable', user: null });
    renderAt('/', [{ path: '/', element: <PdfImportPanel /> }]);
    expect(screen.getByText('AI bu sürümde kapalı')).toBeInTheDocument();
    expect(screen.getByText('Gizli iş belgelerini yükleme.')).toBeInTheDocument();
  });

  it('pasting text queues a job and shows its progress card', async () => {
    const user = userEvent.setup();
    renderAt('/', [{ path: '/', element: <TextImportPanel hidePrivacyNote /> }]);
    expect(screen.queryByText('Gizli iş belgelerini yükleme.')).toBeNull();
    const area = screen.getByRole('textbox', { name: 'İngilizce metin' });
    await user.click(area);
    await user.paste(
      FAKE_SPECS.slice(0, 5)
        .map((s) => s.sentence)
        .join(' '),
    );
    expect(screen.getByText(/karakter · 1 parça/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Kelimeleri çıkar' }));
    await waitFor(async () => expect(await db.import_jobs.count()).toBe(1));
    const job = (await db.import_jobs.toArray())[0] as ImportJobRecord;
    expect(job.title).toMatch(/^After years of trying/);
    expect(await screen.findByText(/0\/1 parça/)).toBeInTheDocument();
    expect(area).toHaveValue('');
  });

  it('the PDF panel rejects a non-PDF file with a clear message', async () => {
    const user = userEvent.setup({ applyAccept: false });
    const { container } = render(
      <TooltipProvider>
        <PdfImportPanel />
      </TooltipProvider>,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(['hello'], 'notes.txt', { type: 'text/plain' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Bu dosya bir PDF değil.');
  });
});

describe('ImportPreviewPage', () => {
  it('smart sections: for you (selected by level), easy and known closed; Biliyorum; confirm creates notes', async () => {
    // "bank" (kıyı) already exists with the same lexicon sense → "Biliyorsun", not selected.
    const { addNoteWithSenses } = await import('@/data');
    await addNoteWithSenses({
      term: 'bank',
      senses: [{ meaning_tr: 'kıyı', lexicon_sense_id: 'lex-sense-9' }],
    });
    const marked: string[] = [];
    setKnownTermsProvider({
      getKnownTermKeys: () => Promise.resolve(new Set()),
      markKnown: (term) => {
        marked.push(term);
        return Promise.resolve();
      },
    });
    const jobId = await seedReadyJob(40);
    const user = userEvent.setup();
    const router = renderAt(`/import/${jobId}`, [
      { path: '/import/:jobId', element: <ImportPreviewPage /> },
    ]);

    // B1 learner, 40 candidates: 9 B1, 11 B2, 4 above B2, 16 lower (one of them known).
    // Selected: all 9 B1 + 1 B2 (≤ 10 %) + 6 lower (closest level first) = 16.
    const forYou = await screen.findByRole('list', { name: 'Senin için' });
    const items = within(forYou).getAllByRole('listitem');
    expect(items).toHaveLength(26);
    expect(screen.getByTestId('smart-summary')).toHaveTextContent(
      'B1 seviyene göre bu metinde 40 aday: senin için 26, kolay 9, zaten bildiğin 1. Seviyenin bir üstünü aşan 4 aday önerilmedi.',
    );
    expect(screen.getByText('16/36 seçili', { selector: 'span[aria-live]' })).toBeInTheDocument();
    // Never above B2: C1/C2 candidates are not listed at all.
    for (const term of ['subsidy', 'cut corners', 'by and large', 'hinder'])
      expect(screen.queryByText(term, { selector: 'span[lang="en"]' })).toBeNull();
    const selectedLevels = items
      .filter((li) => within(li).getByRole('checkbox').getAttribute('aria-checked') === 'true')
      .map((li) => li.querySelector('[data-level]')?.getAttribute('data-level'));
    expect(selectedLevels.filter((l) => l === 'B1')).toHaveLength(9);
    expect(selectedLevels.filter((l) => l === 'B2')).toHaveLength(1);
    expect(selectedLevels.filter((l) => l === 'A1' || l === 'A2')).toHaveLength(6);

    // Surface highlighted in its sentence; level badge with its source.
    const giveUp = row(items, 'give up');
    expect(within(giveUp).getByText('gave up', { selector: 'mark' })).toBeInTheDocument();
    expect(giveUp.querySelector('[data-level="A2"]')).not.toBeNull();
    // Low confidence: text + percentage, not colour alone.
    const low = row(items, 'curb');
    expect(within(low).getByText('Emin değil')).toBeInTheDocument();
    expect(within(low).getByText('%55')).toBeInTheDocument();

    // "Kolay" and "Biliyorsun" are closed; opening shows them.
    expect(screen.queryByRole('list', { name: 'Kolay' })).toBeNull();
    await user.click(screen.getByRole('button', { name: /^Kolay \d+$/ }));
    expect(
      within(screen.getByRole('list', { name: 'Kolay' })).getAllByRole('listitem'),
    ).toHaveLength(9);
    await user.click(screen.getByRole('button', { name: /^Biliyorsun \d+$/ }));
    const bank = row(
      within(screen.getByRole('list', { name: 'Biliyorsun' })).getAllByRole('listitem'),
      'bank',
    );
    expect(within(bank).getByText('Zaten var')).toBeInTheDocument();
    expect(within(bank).getByRole('checkbox')).toHaveAttribute('aria-checked', 'false');

    // Type filter.
    await user.click(screen.getByRole('radio', { name: /Yapı/ }));
    const patterns = new Set(FAKE_SPECS.filter((s) => s.type === 'pattern').map((s) => s.term));
    const shownPatterns = within(screen.getByRole('list', { name: 'Senin için' }))
      .getAllByRole('listitem')
      .map((li) => li.querySelector('span[lang="en"]')!.textContent!);
    expect(shownPatterns.length).toBeGreaterThan(0);
    expect(shownPatterns.every((t) => patterns.has(t))).toBe(true);
    await user.click(screen.getByRole('radio', { name: /Tümü/ }));

    // "Biliyorum": cope moves to "Biliyorsun", unselected; the provider hears about it.
    const list = () =>
      within(screen.getByRole('list', { name: 'Senin için' })).getAllByRole('listitem');
    await user.click(within(row(list(), 'cope')).getByRole('button', { name: 'cope: biliyorum' }));
    await waitFor(() =>
      expect(
        within(screen.getByRole('list', { name: 'Biliyorsun' })).getByText('cope', {
          selector: 'span[lang="en"]',
        }),
      ).toBeInTheDocument(),
    );
    expect(marked).toEqual(['cope']);

    // Edit a meaning in place.
    const reluctant = row(list(), 'reluctant');
    const input = within(reluctant).getByRole('textbox', { name: 'Türkçe anlamı: reluctant' });
    await user.clear(input);
    await user.type(input, 'gönülsüz{Enter}');
    expect(within(reluctant).getByText('Düzeltildi')).toBeInTheDocument();

    // Select none in "Senin için", then two.
    await user.click(screen.getByRole('button', { name: 'Senin için: hiçbirini seçme' }));
    expect(screen.getByRole('button', { name: 'Eklenecek aday seç' })).toBeDisabled();
    await user.click(within(row(list(), 'reluctant')).getByRole('checkbox'));
    await user.click(within(row(list(), 'give up')).getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: '2 kelimeyi ekle' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/library'));
    expect(await screen.findByText('2 kelime eklendi')).toBeInTheDocument();
    const note = (await db.notes.where('term_norm').equals('reluctant').first())!;
    const sense = (await db.senses.where('note_id').equals(note.id).first())!;
    expect(sense).toMatchObject({
      meaning_tr: 'isteksiz',
      meaning_tr_override: 'gönülsüz',
      lexicon_sense_id: 'lex-sense-1',
    });
    expect((await getImportJob(jobId))!.status).toBe('done');
  }, 30_000);

  it('show_easy_candidates opens "Kolay" by default; a text without B1 words selects nothing', async () => {
    const { updateSettings } = await import('@/data');
    await updateSettings({ show_easy_candidates: true });
    // The first 12 corpus words have no B1 word (A1–A2, B2, C1, C2).
    const jobId = await seedReadyJob(12);
    renderAt(`/import/${jobId}`, [{ path: '/import/:jobId', element: <ImportPreviewPage /> }]);
    expect(
      await screen.findByText(/Bu metinde B1 seviyesinde yeni kelime yok/),
    ).toBeInTheDocument();
    expect(screen.getByText('0/9 seçili', { selector: 'span[aria-live]' })).toBeInTheDocument();
    expect(await screen.findByRole('list', { name: 'Kolay' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Kolay \d+$/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('shows a friendly page for an unknown job', async () => {
    renderAt('/import/nope', [{ path: '/import/:jobId', element: <ImportPreviewPage /> }]);
    expect(await screen.findByText('Bu içe aktarma bulunamadı')).toBeInTheDocument();
  });
});
