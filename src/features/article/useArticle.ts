// Fetching one article (v0.5 İP2, decision 0044) and what the screens need around it: the
// state of the request and the Turkish message for a failure. Saving and word extraction are the
// capture's (features/add/capture.ts).
import { useCallback, useEffect, useRef, useState } from 'react';
import { AiClientError } from '@/ai/client';
import { fetchArticle, type ArticleResponse } from '@/ai/article';
import { logError } from '@/data';

/** Failure kinds the screens tell apart (each has its own message in `article.errors`). */
export const ARTICLE_ERRORS = [
  'offline',
  'not_signed_in',
  'daily_limit',
  'blocked_url',
  'robots_disallowed',
  'not_html',
  'too_large',
  'fetch_failed',
  'paywalled',
  'extract_failed',
  'generic',
] as const;
export type ArticleError = (typeof ARTICLE_ERRORS)[number];

export function articleError(e: unknown): ArticleError {
  if (!(e instanceof AiClientError)) return 'generic';
  if (e.code === 'unauthorized' || e.code === 'not_signed_in') return 'not_signed_in';
  if (e.code === 'invalid_input') return 'blocked_url';
  return (ARTICLE_ERRORS as readonly string[]).includes(e.code)
    ? (e.code as ArticleError)
    : 'generic';
}

/** An http(s) address typed or pasted by the user ("www.x.com/a" gets https://), or null. */
export function normaliseArticleUrl(input: string): string | null {
  let v = input.trim();
  if (!v) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(v)) v = `https://${v}`;
  try {
    const u = new URL(v);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname.includes('.')) return null;
    return u.href;
  } catch {
    return null;
  }
}

export type ArticleState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; article: ArticleResponse }
  | { status: 'error'; error: ArticleError };

const isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine);

/** One request per address and session, so a re-render or going back never fetches twice. */
const inflight = new Map<string, Promise<ArticleResponse>>();

export function useArticleFetch(fetcher: typeof fetchArticle = fetchArticle) {
  const [state, setState] = useState<ArticleState>({ status: 'idle' });
  const seq = useRef(0);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const run = useCallback(
    (url: string, opts: { retry?: boolean } = {}) => {
      const n = ++seq.current;
      if (!isOnline()) {
        setState({ status: 'error', error: 'offline' });
        return;
      }
      setState({ status: 'loading' });
      if (opts.retry) inflight.delete(url);
      let p = inflight.get(url);
      if (!p) {
        p = fetcher(url);
        inflight.set(url, p);
        p.catch(() => inflight.delete(url));
      }
      p.then(
        (article) => {
          if (live.current && n === seq.current) setState({ status: 'done', article });
        },
        (e: unknown) => {
          const error = articleError(e);
          if (error === 'generic') void logError(e, 'article.fetch');
          if (live.current && n === seq.current) setState({ status: 'error', error });
        },
      );
    },
    [fetcher],
  );
  return { state, run };
}

/** Words with a letter, for the "n kelime" line. */
export function wordCount(paragraphs: readonly string[]): number {
  return paragraphs.reduce((n, p) => n + p.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length, 0);
}
