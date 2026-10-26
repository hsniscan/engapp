// Deno smoke test: linkedom + Readability through the npm specifiers of this function's import
// map, on the saved fixtures (the full suite is _shared/article.test.ts under vitest).
// Run: cd supabase/functions/fetch-article && deno test --allow-read extract_test.ts
import { extractArticle } from '../_shared/article-extract.ts';
import { decodeHtml } from '../_shared/article.ts';

const dir = new URL('../_shared/testing/article-fixtures/', import.meta.url);
const load = (name: string) => decodeHtml('text/html', Deno.readFileSync(new URL(name, dir)));

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

Deno.test('extracts the article fixtures under Deno', () => {
  const news = extractArticle(load('01-news.html'), 'https://news.example/a');
  assert(news.ok, 'news extracts');
  assert(news.article.paragraphs.length === 5, 'five paragraphs');
  assert(news.article.byline === 'Lena Ortiz', 'byline');
  const cp = extractArticle(load('06-cp1252.bin'), 'https://a.example/');
  assert(cp.ok && cp.article.paragraphs.join(' ').includes('“People come here'), 'cp1252');
});

Deno.test('refuses a paywall teaser and an empty shell under Deno', () => {
  const pay = extractArticle(load('04-paywall.html'), 'https://a.example/');
  assert(!pay.ok && pay.reason === 'paywalled', 'paywall');
  const shell = extractArticle(load('05-spa-shell.html'), 'https://a.example/');
  assert(!shell.ok && shell.reason === 'extract_failed', 'shell');
});
