import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import '@/i18n';
import { db, getImportJob } from '@/data';
import { setAuthStateForTesting } from '@/features/auth/session';
import { resetDb } from '@/test/db';
import { Toaster, TooltipProvider } from '@/ui';
import { ImportPreviewPage } from './ImportPreviewPage';
import { PdfImportPanel } from './PdfImportPanel';
import { TextImportPanel } from './TextImportPanel';
import { FAKE_SPECS, seedReadyJob } from './testing/fakeData';

function renderAt(path: string, routes: { path: string; element: React.ReactNode }[]) {
  const router = createMemoryRouter(
    [...routes, { path: '/library', element: <p>library page</p> }, { path: '/add', element: <p>add page</p> }],
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

const signedIn = () => setAuthStateForTesting({ status: 'signed_in', user: { id: 'u1', email: 'h@example.com', name: 'Hasan', avatarUrl: null } });

beforeEach(async () => {
  await resetDb();
  signedIn();
});
afterEach(cleanup);

/** The preview row whose headword is `term`. */
const row = (items: HTMLElement[], term: string) => items.find((li) => li.querySelector('span[lang="en"]')?.textContent === term)!;

describe('import panels', () => {
  it('guests see a calm sign-in prompt and the privacy note', () => {
    setAuthStateForTesting({ status: 'guest', user: null });
    renderAt('/', [{ path: '/', element: <TextImportPanel /> }]);
    expect(screen.getByText('Gizli iş belgelerini yükleme.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /AI ile kart çıkarmak için giriş yap/ })).toBeInTheDocument();
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
    await user.paste(FAKE_SPECS.slice(0, 5).map((s) => s.sentence).join(' '));
    expect(screen.getByText(/karakter · 1 parça/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Kelimeleri çıkar' }));
    await waitFor(async () => expect(await db.import_jobs.count()).toBe(1));
    const job = (await db.import_jobs.toArray())[0]!;
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
  it('lists candidates with highlights, flags, statuses and filters; confirm creates notes', async () => {
    // "bank" (kıyı) already exists with the same lexicon sense → "zaten var", preselected off.
    const { addNoteWithSenses } = await import('@/data');
    await addNoteWithSenses({ term: 'bank', senses: [{ meaning_tr: 'kıyı', lexicon_sense_id: 'lex-sense-9' }] });
    const jobId = await seedReadyJob(40);
    const user = userEvent.setup();
    const router = renderAt(`/import/${jobId}`, [{ path: '/import/:jobId', element: <ImportPreviewPage /> }]);

    const list = await screen.findByRole('list', { name: 'Önizleme' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(40);
    expect(screen.getByText('39/40 seçili', { selector: 'span[aria-live]' })).toBeInTheDocument();

    // Surface highlighted in its sentence.
    const giveUp = items[0]!;
    expect(within(giveUp).getByText('gave up', { selector: 'mark' })).toBeInTheDocument();
    // Existing sense: badge with words, unchecked.
    const bank = row(items, 'bank');
    expect(within(bank).getByText('Zaten var')).toBeInTheDocument();
    expect(within(bank).getByRole('checkbox')).toHaveAttribute('aria-checked', 'false');
    // Low confidence: text + percentage, not colour alone.
    const low = row(items, 'curb');
    expect(within(low).getByText('Emin değil')).toBeInTheDocument();
    expect(within(low).getByText('%55')).toBeInTheDocument();

    // Type filter.
    await user.click(screen.getByRole('radio', { name: /Yapı/ }));
    expect(within(screen.getByRole('list', { name: 'Önizleme' })).getAllByRole('listitem')).toHaveLength(
      FAKE_SPECS.filter((s) => s.type === 'pattern').length,
    );
    await user.click(screen.getByRole('radio', { name: /Tümü/ }));

    // Edit a meaning in place.
    const reluctant = row(within(screen.getByRole('list', { name: 'Önizleme' })).getAllByRole('listitem'), 'reluctant');
    const input = within(reluctant).getByRole('textbox', { name: 'Türkçe anlamı: reluctant' });
    await user.clear(input);
    await user.type(input, 'gönülsüz{Enter}');
    expect(within(reluctant).getByText('Düzeltildi')).toBeInTheDocument();

    // Select none, then two.
    await user.click(screen.getByRole('button', { name: 'Hiçbirini seçme' }));
    expect(screen.getByRole('button', { name: 'Eklenecek aday seç' })).toBeDisabled();
    await user.click(within(reluctant).getByRole('checkbox'));
    const fresh = within(screen.getByRole('list', { name: 'Önizleme' })).getAllByRole('listitem');
    await user.click(within(row(fresh, 'give up')).getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: '2 kelimeyi ekle' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/library'));
    expect(await screen.findByText('2 kelime eklendi')).toBeInTheDocument();
    const note = (await db.notes.where('term_norm').equals('reluctant').first())!;
    const sense = (await db.senses.where('note_id').equals(note.id).first())!;
    expect(sense).toMatchObject({ meaning_tr: 'isteksiz', meaning_tr_override: 'gönülsüz', lexicon_sense_id: 'lex-sense-1' });
    expect((await getImportJob(jobId))!.status).toBe('done');
  });

  it('shows a friendly page for an unknown job', async () => {
    renderAt('/import/nope', [{ path: '/import/:jobId', element: <ImportPreviewPage /> }]);
    expect(await screen.findByText('Bu içe aktarma bulunamadı')).toBeInTheDocument();
  });
});
