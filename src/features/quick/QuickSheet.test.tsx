import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuickPreview } from '@/data/quick';
import { installDomPolyfills } from '@/test/ui';
import { TooltipProvider } from '@/ui';
import { QuickSheet } from './QuickSheet';

const SID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const PREVIEW: QuickPreview = {
  term: 'serendipity',
  matched: 'serendipity',
  origin: 'bank',
  ipa: 'ˌserənˈdɪpəti',
  cefr: 'C1',
  senses: [
    {
      key: 'serendipity|noun#0',
      meaning_tr: 'mutlu tesadüf',
      pos: 'noun',
      gloss_en: null,
      example_en: 'Meeting her was pure serendipity.',
      lexicon_sense_id: SID(1),
    },
    {
      key: 'serendipity|noun#1',
      meaning_tr: 'şans eseri bulma',
      pos: 'noun',
      gloss_en: null,
      example_en: null,
      lexicon_sense_id: SID(2),
    },
  ],
  bank: [],
  lexiconTermId: null,
  owned: null,
  mine: [],
  picture: null,
};

// The page's data layer is mocked: the sheet is tested on fixed data.
const quickPreview = vi.fn(async (): Promise<QuickPreview> => PREVIEW);
const addQuickCard = vi.fn(async () => ({ term: 'serendipity', added: 1, cards: 2 }));
const saveText = vi.fn(async () => '0192f3a0-1b2c-7d4e-8f90-123456789abc');
vi.mock('@/data/quick', () => ({
  quickPreview: () => quickPreview(),
  addQuickCard: (...a: unknown[]) => addQuickCard(...(a as [])),
  previewFromSenses: (p: QuickPreview) => p,
}));
vi.mock('@/data/texts', () => ({
  saveText: (...a: unknown[]) => saveText(...(a as [])),
  getText: async () => undefined,
}));
vi.mock('@/features/review/pronunciation', () => ({
  playPronunciation: vi.fn(() => true),
  pronunciationSupported: () => true,
}));

const { QuickPage, SAVED_CLOSE_MS } = await import('./QuickPage');

function renderPage(url: string) {
  installDomPolyfills();
  const router = createMemoryRouter(
    [
      { path: '/', element: <p>home</p> },
      { path: '/quick', element: <QuickPage /> },
      { path: '*', element: <p>elsewhere</p> },
    ],
    { initialEntries: ['/', url], initialIndex: 1 },
  );
  render(
    <TooltipProvider>
      <RouterProvider router={router} />
    </TooltipProvider>,
  );
  return router;
}

beforeEach(() => {
  vi.clearAllMocks();
  quickPreview.mockImplementation(async () => PREVIEW);
});

describe('QuickSheet (presentational)', () => {
  it('a word: meanings, level, IPA, audio and "Karta ekle", the first meaning picked', () => {
    installDomPolyfills();
    const onToggle = vi.fn();
    const onAdd = vi.fn();
    const onSpeak = vi.fn();
    render(
      <TooltipProvider>
        <QuickSheet
          route={{ kind: 'term', term: 'serendipity' }}
          preview={PREVIEW}
          picked={new Set([PREVIEW.senses[0]!.key])}
          onToggleSense={onToggle}
          onAdd={onAdd}
          canSpeak
          onSpeak={onSpeak}
          onClose={() => {}}
        />
      </TooltipProvider>,
    );
    const sheet = screen.getByRole('dialog', { name: 'serendipity' });
    expect(within(sheet).getByText('C1')).toBeVisible();
    expect(within(sheet).getByText('/ˌserənˈdɪpəti/')).toBeVisible();
    const senses = within(sheet).getAllByTestId('quick-sense');
    expect(senses[0]).toHaveAttribute('aria-pressed', 'true');
    expect(senses[1]).toHaveAttribute('aria-pressed', 'false');
    expect(within(sheet).getByText('Meeting her was pure serendipity.')).toBeVisible();
    fireEvent.click(senses[1]!);
    expect(onToggle).toHaveBeenCalledWith('serendipity|noun#1');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Dinle: serendipity' }));
    expect(onSpeak).toHaveBeenCalled();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Karta ekle' }));
    expect(onAdd).toHaveBeenCalled();
    // No app navigation in the sheet.
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('an unknown word offline: says so and offers writing the meaning', () => {
    installDomPolyfills();
    const onWriteOwn = vi.fn();
    render(
      <QuickSheet
        route={{ kind: 'term', term: 'flibbertigibbet' }}
        preview={{ ...PREVIEW, origin: 'none', term: 'flibbertigibbet', senses: [], matched: null }}
        lookup="offline"
        onWriteOwn={onWriteOwn}
        onClose={() => {}}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(/telefonunda yok/);
    expect(screen.queryByRole('button', { name: 'Karta ekle' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Anlamını kendim yazayım' }));
    expect(onWriteOwn).toHaveBeenCalled();
  });

  it('a long selection: reader and word extraction', () => {
    installDomPolyfills();
    const onOpenReader = vi.fn();
    const onExtract = vi.fn();
    render(
      <QuickSheet
        route={{ kind: 'text', text: 'One two three four five.', words: 5 }}
        onOpenReader={onOpenReader}
        onExtract={onExtract}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('5 kelime')).toBeVisible();
    fireEvent.click(screen.getByTestId('quick-reader'));
    fireEvent.click(screen.getByTestId('quick-extract'));
    expect(onOpenReader).toHaveBeenCalled();
    expect(onExtract).toHaveBeenCalled();
  });
});

describe('QuickPage (web)', () => {
  it('adds the picked meanings, confirms, then goes back', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const router = renderPage('/quick?text=%E2%80%9Cserendipity.%E2%80%9D');
      const add = await screen.findByRole('button', { name: 'Karta ekle' });
      // Both meanings.
      fireEvent.click(screen.getAllByTestId('quick-sense')[1]!);
      fireEvent.click(add);
      await screen.findByText('“serendipity” kartlarına eklendi');
      expect(screen.getByText('2 kart oluşturuldu.')).toBeVisible();
      expect(addQuickCard).toHaveBeenCalledWith(PREVIEW, [
        'serendipity|noun#0',
        'serendipity|noun#1',
      ]);
      await act(async () => {
        vi.advanceTimersByTime(SAVED_CLOSE_MS + 50);
      });
      await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('"Okuyucuda aç" saves a paste text and opens the reader', async () => {
    const router = renderPage(
      `/quick?text=${encodeURIComponent('The committee reluctantly postponed the decision.')}`,
    );
    fireEvent.click(await screen.findByTestId('quick-reader'));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/oku/0192f3a0-1b2c-7d4e-8f90-123456789abc'),
    );
    expect(saveText).toHaveBeenCalledWith({
      source_url: null,
      kind: 'paste',
      title: 'The committee reluctantly postponed the decision.',
      body: 'The committee reluctantly postponed the decision.',
    });
  });

  it('"Kelimeleri çıkar" hands the text to the share flow', async () => {
    const text = 'The committee reluctantly postponed the decision.';
    const router = renderPage(`/quick?text=${encodeURIComponent(text)}`);
    fireEvent.click(await screen.findByTestId('quick-extract'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/share'));
    expect(router.state.location.search).toBe(`?${new URLSearchParams({ text })}`);
  });

  it('the close button goes back', async () => {
    const router = renderPage('/quick?text=serendipity');
    fireEvent.click(await screen.findByRole('button', { name: 'Kapat' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });
});
