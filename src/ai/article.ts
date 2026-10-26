// Client of the fetch-article edge function (v0.5 İP2, decision 0044): one web address in,
// the article as plain paragraphs out. Validated with the server's own contract.
import {
  articleRequest,
  articleResponse,
  type ArticleResponse,
} from '../../supabase/functions/_shared/article-contract';
import { call, type AiClientDeps } from './client';

export type { ArticleResponse };

export async function fetchArticle(url: string, deps: AiClientDeps = {}): Promise<ArticleResponse> {
  const body = articleRequest.parse({ url });
  // The server stops at 10 s; leave room for the round trip.
  return call('fetch-article', body, (x) => articleResponse.parse(x), {
    timeoutMs: 25_000,
    ...deps,
  });
}

/** The article as a ReaderText body: paragraphs separated by a blank line. */
export function articleBody(a: Pick<ArticleResponse, 'paragraphs'>): string {
  return a.paragraphs.join('\n\n');
}
