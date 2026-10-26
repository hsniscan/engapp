// Contract of the fetch-article edge function (v0.5 İP2, decision 0044). Imported by the
// function and by the web client (src/ai/article.ts). The answer is plain text only.

import { z } from 'zod';

/** Longest address accepted. */
export const MAX_ARTICLE_URL_CHARS = 2048;
/** Articles per user and UTC day (env ARTICLE_DAILY_LIMIT). */
export const DEFAULT_ARTICLE_DAILY_LIMIT = 30;
/** Text returned at most; a longer article is cut at a paragraph boundary. */
export const MAX_ARTICLE_TEXT_CHARS = 200_000;
/** Fewer words than this is not an article (a teaser, a cookie wall, an empty shell). */
export const MIN_ARTICLE_WORDS = 60;

export const articleRequest = z.object({
  url: z.string().trim().min(1).max(MAX_ARTICLE_URL_CHARS),
});
export type ArticleRequest = z.infer<typeof articleRequest>;

export const articleResponse = z.object({
  /** The address the text came from, after redirects. */
  url: z.string(),
  title: z.string(),
  byline: z.string().nullable(),
  site: z.string().nullable(),
  /** The page's declared language (`<html lang>`), lower case; null when absent. */
  lang: z.string().nullable(),
  paragraphs: z.array(z.string()),
  /** The article was longer than MAX_ARTICLE_TEXT_CHARS and was cut. */
  truncated: z.boolean(),
  usage: z.object({ used: z.number(), limit: z.number() }),
});
export type ArticleResponse = z.infer<typeof articleResponse>;
