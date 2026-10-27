// The photo flow with a fake recogniser: no canvas, no ML Kit, no tesseract (decision 0045).
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportJobRecord } from '@/data';
import { db } from '@/data/db';
import type { OcrBlock, OcrResult } from '@/domain/ocr';
import { setAuthStateForTesting } from '@/features/auth/session';
import { resetDb } from '@/test/db';
import { installDomPolyfills } from '@/test/ui';
import { TooltipProvider } from '@/ui';
import { NotAnImageError } from './image';
import { OcrPage } from './OcrPage';
import type { PreparedImage, Recognizer } from './types';

function line(text: string, y: number, confidence = 0.95, x = 100, w = 600) {
  return { text, box: { x, y, w, h: 20 }, confidence };
}

function page(blocks: OcrBlock[]): OcrResult {
  return { engine: 'mlkit', width: 1000, height: 1400, blocks };
}

const BOOK = page([
  {
    box: { x: 100, y: 100, w: 600, h: 120 },
    lines: [
      line('CHAPTER ONE', 100),
      line('It was a bright cold day in Ap-', 160),
      line('ril, and the clocks were striking', 188),
      line('thirteen.', 216, 0.95, 100, 120),
    ],
  },
  { box: { x: 380, y: 1300, w: 40, h: 20 }, lines: [line('7', 1300, 0.9, 380, 40)] },
]);

const fakeImage: PreparedImage = { canvas: {} as HTMLCanvasElement, width: 1000, height: 1400 };

function recognizerOf(result: OcrResult | Error): Recognizer & { calls: number } {
  const r = {
    engine: 'mlkit' as const,
    calls: 0,
    async recognize(_img: PreparedImage, onProgress?: (p: number | null) => void) {
      r.calls++;
      onProgress?.(0.5);
      if (result instanceof Error) throw result;
      return result;
    },
  };
  return r;
}

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname + loc.search}</p>;
}

function renderPage(
  recognizer: Recognizer,
  prepare: (f: Blob) => Promise<PreparedImage> = async () => fakeImage,
) {
  installDomPolyfills();
  const router = createMemoryRouter(
    [
      {
        path: '/fotograf',
        element: <OcrPage getRecognizer={async () => recognizer} prepare={prepare} native />,
      },
      { path: '*', element: <Where /> },
    ],
    { initialEntries: ['/fotograf'] },
  );
  render(
    <TooltipProvider>
      <RouterProvider router={router} />
    </TooltipProvider>,
  );
  return router;
}

const signedIn = () =>
  setAuthStateForTesting({
    status: 'signed_in',
    user: { id: 'u1', email: 'h@example.com', name: 'Hasan', avatarUrl: null },
  });

beforeEach(() => setAuthStateForTesting({ status: 'guest', user: null }));

const photo = () =>
  new File([new Uint8Array([0xff, 0xd8, 0xff])], 'page.jpg', { type: 'image/jpeg' });

async function pickPhoto() {
  fireEvent.change(screen.getByTestId('ocr-gallery-input'), { target: { files: [photo()] } });
  return screen.findByRole('heading', { name: 'Okunan metni kontrol et' });
}

beforeEach(async () => {
  await resetDb();
});

describe('Fotoğraftan metin', () => {
  it('offers camera and gallery, and says the photo stays on the device', () => {
    renderPage(recognizerOf(BOOK));
    expect(screen.getByRole('heading', { name: 'Fotoğraftan metin' })).toBeInTheDocument();
    expect(screen.getByTestId('ocr-camera')).toHaveTextContent('Fotoğraf çek');
    expect(screen.getByTestId('ocr-gallery')).toHaveTextContent('Galeriden seç');
    expect(screen.getByTestId('ocr-camera-input')).toHaveAttribute('capture', 'environment');
    expect(screen.getByTestId('ocr-camera-input')).toHaveAttribute('accept', 'image/*');
    expect(screen.getByText(/Fotoğraf cihazından çıkmaz/)).toBeInTheDocument();
    expect(screen.queryByTestId('ocr-web-note')).not.toBeInTheDocument();
  });

  it('shows the recognised lines, page number unticked; tap and edit change the text', async () => {
    renderPage(recognizerOf(BOOK));
    await pickPhoto();
    const list = screen.getByRole('list', { name: 'Okunan satırlar' });
    const rows = within(list).getAllByTestId('ocr-line');
    expect(rows.map((r) => r.getAttribute('aria-pressed'))).toEqual([
      'true',
      'true',
      'true',
      'true',
      'false',
    ]);
    expect(screen.getByTestId('ocr-count')).toHaveTextContent('4 / 5 satır seçili');
    expect(screen.queryByTestId('ocr-low-warning')).not.toBeInTheDocument();

    // Take the heading out.
    fireEvent.click(rows[0]!);
    expect(rows[0]).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('ocr-count')).toHaveTextContent('3 / 5 satır seçili');

    // Fix a word on the last line.
    fireEvent.click(within(list).getAllByRole('button', { name: 'Satırı düzelt' })[3]!);
    const input = screen.getByRole('textbox', { name: /Satırın metni/ });
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: 'thirteen!' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(within(list).getByText('thirteen!')).toBeInTheDocument();
  });

  it('"Okuyucuda aç" saves an ocr text with joined lines and opens the reader', async () => {
    const router = renderPage(recognizerOf(BOOK));
    await pickPhoto();
    fireEvent.click(within(screen.getByRole('list')).getAllByTestId('ocr-line')[0]!);
    fireEvent.click(screen.getByTestId('ocr-open-reader'));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/oku\/.+/));
    const id = router.state.location.pathname.split('/')[2]!;
    const row = await db.texts.get(id);
    expect(row).toMatchObject({
      kind: 'ocr',
      body: 'It was a bright cold day in April, and the clocks were striking thirteen.',
      title: 'It was a bright cold day in April, and the…',
    });
  });

  it('"Bu metindeki kelimeleri çıkar" saves the text, then opens its extraction (v0.5.1)', async () => {
    signedIn();
    const router = renderPage(recognizerOf(BOOK));
    await pickPhoto();
    fireEvent.click(screen.getByTestId('ocr-extract'));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/import\//));
    const job = (await db.import_jobs.toArray())[0] as ImportJobRecord;
    expect(router.state.location.pathname).toBe(`/import/${job.id}`);
    const text = await db.texts.get(job.text_id!);
    expect(text?.kind).toBe('ocr');
    expect(text?.body).toBe(
      'CHAPTER ONE\n\nIt was a bright cold day in April, and the clocks were striking thirteen.',
    );
  });

  it('a guest reads the photo; extraction asks for sign-in', async () => {
    renderPage(recognizerOf(BOOK));
    await pickPhoto();
    expect(screen.getByTestId('ocr-open-reader')).toBeEnabled();
    expect(screen.queryByTestId('ocr-extract')).toBeNull();
    expect(screen.getByTestId('ocr-extract-signin')).toHaveTextContent('giriş yap');
  });

  it('warns when the photo read poorly and marks the unsure lines', async () => {
    renderPage(
      recognizerOf(
        page([
          {
            box: { x: 0, y: 0, w: 600, h: 60 },
            lines: [
              line('Blurry wrds hcre and there', 0, 0.45),
              line('more of the same text', 28, 0.7),
            ],
          },
        ]),
      ),
    );
    await pickPhoto();
    expect(screen.getByTestId('ocr-low-warning')).toHaveTextContent('net okunamadı');
    expect(screen.getAllByTestId('ocr-low')).toHaveLength(1);
  });

  it('disables the actions when nothing is selected', async () => {
    signedIn();
    renderPage(recognizerOf(BOOK));
    await pickPhoto();
    fireEvent.click(screen.getByRole('button', { name: 'Hiçbirini seçme' }));
    expect(screen.getByTestId('ocr-open-reader')).toBeDisabled();
    expect(screen.getByTestId('ocr-extract')).toBeDisabled();
    expect(screen.getByText('En az bir satır seç.')).toBeInTheDocument();
  });

  it('says so when there is no text, and lets the user try another photo', async () => {
    renderPage(recognizerOf(page([])));
    fireEvent.change(screen.getByTestId('ocr-gallery-input'), { target: { files: [photo()] } });
    expect(await screen.findByText('Fotoğrafta metin bulunamadı')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Başka fotoğraf' }));
    expect(screen.getByTestId('ocr-gallery')).toBeInTheDocument();
  });

  it('reports a file that is not a picture, and a recogniser failure', async () => {
    renderPage(recognizerOf(BOOK), async () => {
      throw new NotAnImageError('nope');
    });
    fireEvent.change(screen.getByTestId('ocr-gallery-input'), { target: { files: [photo()] } });
    expect(await screen.findByTestId('ocr-error')).toHaveTextContent('fotoğraf olarak açılamadı');
  });

  it('reports a recogniser failure without leaving the page', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderPage(recognizerOf(new Error('engine crashed')));
    fireEvent.change(screen.getByTestId('ocr-gallery-input'), { target: { files: [photo()] } });
    expect(await screen.findByTestId('ocr-error')).toHaveTextContent('Metin okunamadı');
    spy.mockRestore();
  });
});
