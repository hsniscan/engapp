// POST /functions/v1/fetch-article — one web page as plain article text. Contract:
// _shared/article-contract.ts; design: docs/decisions/0044-article-import.md.
import { articleDailyLimit, runFetchArticle } from '../_shared/article.ts';
import { SupabaseArticleStore } from '../_shared/article-store.ts';
import { createHandler, parseOrigins } from '../_shared/http.ts';
import { dohResolver, type Resolver } from '../_shared/net-guard.ts';
import { log } from '../_shared/log.ts';
import {
  createAdminClient,
  createAuthenticator,
  loadServerConfig,
} from '../_shared/supabase-store.ts';

const env = (k: string) => Deno.env.get(k);
const cfg = loadServerConfig(env);
const store = new SupabaseArticleStore(createAdminClient(cfg));
const logger = log('fetch-article');
const dailyLimit = articleDailyLimit(env);
const doh = dohResolver(fetch);

/** Deno.resolveDns where the runtime offers it; DNS over HTTPS otherwise. */
const resolve: Resolver = async (host) => {
  if (typeof Deno.resolveDns === 'function') {
    const one = (type: 'A' | 'AAAA') =>
      Deno.resolveDns(host, type).catch((e: unknown) => {
        if (e instanceof Deno.errors.NotFound) return [] as string[];
        throw e;
      });
    try {
      const [a, aaaa] = await Promise.all([one('A'), one('AAAA')]);
      return [...a, ...aaaa];
    } catch (e) {
      logger('resolveDns unavailable, using DoH', { error: String(e) });
    }
  }
  return doh(host);
};

Deno.serve(
  createHandler({
    cors: { allowedOrigins: parseOrigins(env('ALLOWED_ORIGINS')) },
    authenticate: createAuthenticator(cfg),
    log: logger,
    run: (body, userId) =>
      runFetchArticle(body, { userId, store, resolve, fetch, dailyLimit, log: logger }),
  }),
);
