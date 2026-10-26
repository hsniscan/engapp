import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiClientError } from '@/ai/client';
import type { ArticleResponse } from '@/ai/article';
import { db } from '@/data/db';
import { setAuthStateForTesting } from '@/features/auth/session';
import { resetDb } from '@/test/db';
import { installDomPolyfills } from '@/test/ui';
import { TooltipProvider } from '@/ui';
import { ArticleFetch } from './ArticleFetch';
import { SubtitlePage } from './SubtitlePage';
import { articleError, normaliseArticleUrl } from './useArticle';

const ARTICLE: ArticleResponse = {
  url: 'https://news.example/a',
  title: 'City council approves new bike lanes',
  byline: 'Lena Ortiz',
  site: 'The Riverside Gazette',
  lang: 'en',
  paragraphs: ['After a long debate the council voted.', 'The first lane opens in spring.'],
  truncated: false,
  usage: { used: 1, limit: 30 },
};

const signIn = () =>
  setAuthStateForTesting({
    status: 'signed_in',
    user: { id: 'u1', email: null, name: null, avatarUrl: null },
  });

function renderAt(element: React.ReactNode, url = '/x') {
  installDomPolyfills();
  const router = createMemoryRouter(
    [
      { path: '/x', element },
      { path: '/oku/:id', element: <p>reader</p> },
      { path: '/import/:id', element: <p>import preview</p> },
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

beforeEach(async () => {
  await resetDb();
  signIn();
});
afterEach(() => {
  setAuthStateForTesting({ status: 'guest', user: null });
  vi.restoreAllMocks();
});

describe('normaliseArticleUrl', () => {
  it('accepts web addresses, adds https:// and refuses the rest', () => {
    expect(normaliseArticleUrl('https://a.example/x')).toBe('https://a.example/x');
    expect(normaliseArticleUrl('  www.bbc.co.uk/news ')).toBe('https://www.bbc.co.uk/news');
    expect(normaliseArticleUrl('ftp://a.example/')).toBeNull();
    expect(normaliseArticleUrl('javascript:alert(1)')).toBeNull();
    expect(normaliseArticleUrl('hello')).toBeNull();
    expect(normaliseArticleUrl('')).toBeNull();
  });
});

describe('articleError', () => {
  it('maps server and client codes to a message key', () => {
    expect(articleError(new AiClientError('paywalled', 'x'))).toBe('paywalled');
    expect(articleError(new AiClientError('offline', 'x'))).toBe('offline');
    expect(articleError(new AiClientError('unauthorized', 'x'))).toBe('not_signed_in');
    expect(articleError(new AiClientError('internal', 'x'))).toBe('generic');
    expect(articleError(new Error('boom'))).toBe('generic');
  });
});

describe('ArticleFetch', () => {
  it('shows the article and opens it in the reader as an article text', async () => {
    const fetcher = vi.fn(async () => ARTICLE);
    const router = renderAt(<ArticleFetch url="https://news.example/a?1" fetcher={fetcher} />);
    expect(await screen.findByTestId('text-result-title')).toHaveTextContent(ARTICLE.title);
    expect(screen.getByText(/Lena Ortiz · The Riverside Gazette/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('text-open-reader'));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/oku\//));
    const id = router.state.location.pathname.split('/')[2]!;
    const row = await db.texts.get(id);
    expect(row).toMatchObject({
      kind: 'article',
      title: ARTICLE.title,
      body: ARTICLE.paragraphs.join('\n\n'),
      source_url: ARTICLE.url,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('offers word extraction as the second way', async () => {
    const router = renderAt(
      <ArticleFetch url="https://news.example/a?2" fetcher={async () => ARTICLE} />,
    );
    fireEvent.click(await screen.findByTestId('text-extract'));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/import\//));
    expect(await db.import_jobs.count()).toBe(1);
  });

  it('a paywall gets a clear message, the copy-paste way and the fallback', async () => {
    renderAt(
      <ArticleFetch
        url="https://news.example/a?3"
        fetcher={async () => {
          throw new AiClientError('paywalled', 'subscribers only', 422);
        }}
        fallback={<p>title only</p>}
      />,
    );
    expect(await screen.findByTestId('article-error-message')).toHaveTextContent(
      'yalnızca abonelere açık',
    );
    expect(screen.getByTestId('article-paste')).toHaveAttribute('href', '/add?tab=paste');
    expect(screen.getByText('title only')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tekrar dene' })).toBeNull();
  });

  it('offline: no request, the offline message and a retry', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const fetcher = vi.fn(async () => ARTICLE);
    renderAt(<ArticleFetch url="https://news.example/a?4" fetcher={fetcher} />);
    expect(await screen.findByTestId('article-error-message')).toHaveTextContent(
      'İnternet bağlantısı yok',
    );
    expect(fetcher).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Tekrar dene' })).toBeInTheDocument();
  });
});

describe('SubtitlePage', () => {
  it('parses an .srt file on the device and saves it as a subtitle text', async () => {
    const router = renderAt(<SubtitlePage />);
    const srt =
      '1\n00:00:01,000 --> 00:00:02,000\n<i>Hello there.</i>\n\n2\n00:00:02,100 --> 00:00:03,000\nJOHN: How are you?\n';
    const file = new File([srt], 'Show.S01E01.en.srt', { type: 'application/x-subrip' });
    await userEvent.upload(screen.getByTestId('subtitle-file'), file);
    expect(await screen.findByTestId('text-result-title')).toHaveTextContent('Show S01E01');
    expect(screen.getByTestId('text-result-body')).toHaveTextContent('Hello there. How are you?');
    fireEvent.click(screen.getByTestId('text-open-reader'));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/oku\//));
    const row = await db.texts.get(router.state.location.pathname.split('/')[2]!);
    expect(row).toMatchObject({
      kind: 'subtitle',
      body: 'Hello there. How are you?',
      source_url: 'Show.S01E01.en.srt',
    });
  });

  it('refuses a file that is not a subtitle file', async () => {
    renderAt(<SubtitlePage />);
    // The picker filters by `accept`; a file manager can still hand over anything.
    await userEvent
      .setup({ applyAccept: false })
      .upload(
        screen.getByTestId('subtitle-file'),
        new File(['just words'], 'notes.txt', { type: 'text/plain' }),
      );
    expect(await screen.findByTestId('subtitle-problem')).toHaveTextContent(
      'Bu bir altyazı dosyası değil',
    );
  });
});
