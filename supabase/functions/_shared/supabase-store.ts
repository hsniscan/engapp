// Real AiStore (service-role client) and JWT authentication for the edge functions.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ApiError } from './errors.ts';
import { bearerToken } from './http.ts';
import { lexiconEntry, type LexiconEntry } from './contracts.ts';
import type {
  AiStore,
  CachedChunk,
  LevelRefs,
  LexiconUpsertItem,
  LexiconUpsertResult,
  LexTerm,
  UsageResult,
} from './store.ts';

type Env = (key: string) => string | undefined;

/** Picks the "default" key from SUPABASE_*_KEYS JSON, else the legacy variable. */
function pickKey(env: Env, jsonVar: string, legacyVar: string): string | undefined {
  const raw = env(jsonVar);
  if (raw) {
    try {
      const keys = JSON.parse(raw) as Record<string, string>;
      const k = keys['default'] ?? Object.values(keys)[0];
      if (k) return k;
    } catch {
      // not JSON: ignore
    }
  }
  return env(legacyVar) || undefined;
}

export interface ServerConfig {
  url: string;
  publishableKey: string;
  secretKey: string;
  jwks: { keys: unknown[] } | null;
}

export function loadServerConfig(env: Env): ServerConfig {
  const url = env('SUPABASE_URL');
  const publishableKey = pickKey(env, 'SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY');
  const secretKey = pickKey(env, 'SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !publishableKey || !secretKey) {
    throw new Error('SUPABASE_URL and API keys must be set (provided automatically by Supabase)');
  }
  let jwks: { keys: unknown[] } | null = null;
  const rawJwks = env('SUPABASE_JWKS');
  if (rawJwks) {
    try {
      const j = JSON.parse(rawJwks) as { keys?: unknown[] };
      if (Array.isArray(j.keys) && j.keys.length > 0) jwks = { keys: j.keys };
    } catch {
      jwks = null;
    }
  }
  return { url, publishableKey, secretKey, jwks };
}

const clientOpts = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
};

/**
 * Verifies the caller's access token. Asymmetric (ES256/RS256) tokens are checked
 * locally against the project's JWKS (SUPABASE_JWKS, else fetched from
 * /auth/v1/.well-known/jwks.json); legacy HS256 tokens are checked with the Auth server.
 * Anonymous sessions are refused: AI needs a Google account.
 */
export function createAuthenticator(cfg: ServerConfig): (req: Request) => Promise<string> {
  const client = createClient(cfg.url, cfg.publishableKey, clientOpts);
  return async (req) => {
    const token = bearerToken(req);
    if (!token) throw new ApiError('unauthorized', 'Sign in required');
    const { data, error } = await client.auth.getClaims(
      token,
      cfg.jwks ? { jwks: cfg.jwks as unknown as { keys: never[] } } : undefined,
    );
    const claims = data?.claims as
      { sub?: string; role?: string; is_anonymous?: boolean } | undefined;
    if (error || !claims?.sub) throw new ApiError('unauthorized', 'Invalid or expired session');
    if (claims.role !== 'authenticated' || claims.is_anonymous === true) {
      throw new ApiError('unauthorized', 'A signed-in account is required');
    }
    return claims.sub;
  };
}

export function createAdminClient(cfg: ServerConfig): SupabaseClient {
  return createClient(cfg.url, cfg.secretKey, clientOpts);
}

function check<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
}

export class SupabaseAiStore implements AiStore {
  private readonly db: SupabaseClient;
  constructor(db: SupabaseClient) {
    this.db = db;
  }

  async getChunkCache(
    userId: string,
    chunkHash: string,
    promptVersion: string,
    level: string,
  ): Promise<CachedChunk | null> {
    const r = await this.db
      .from('ai_chunk_cache')
      .select('result, model')
      .eq('user_id', userId)
      .eq('chunk_hash', chunkHash)
      .eq('prompt_version', promptVersion)
      .eq('level', level)
      .maybeSingle();
    return check(r, 'chunk cache read') as CachedChunk | null;
  }

  async putChunkCache(
    userId: string,
    chunkHash: string,
    promptVersion: string,
    level: string,
    result: unknown,
    model: string | null,
  ) {
    const r = await this.db.from('ai_chunk_cache').upsert({
      user_id: userId,
      chunk_hash: chunkHash,
      prompt_version: promptVersion,
      level,
      result,
      model,
      created_at: new Date().toISOString(),
    });
    check(r, 'chunk cache write');
  }

  async consumeAi(userId: string, limit: number): Promise<UsageResult> {
    return check(
      await this.db.rpc('ai_consume', { p_user: userId, p_limit: limit }),
      'ai_consume',
    ) as UsageResult;
  }

  async findTerms(norms: string[]): Promise<LexTerm[]> {
    if (norms.length === 0) return [];
    return check(
      await this.db.rpc('lexicon_find', { p_norms: norms, p_max_senses: 12 }),
      'lexicon_find',
    ) as LexTerm[];
  }

  async upsertLexicon(items: LexiconUpsertItem[]): Promise<LexiconUpsertResult[]> {
    if (items.length === 0) return [];
    return check(
      await this.db.rpc('lexicon_upsert', { p_items: items }),
      'lexicon_upsert',
    ) as LexiconUpsertResult[];
  }

  async getEntries(ids: string[]): Promise<LexiconEntry[]> {
    if (ids.length === 0) return [];
    const rows = check(
      await this.db.rpc('lexicon_get', { p_ids: ids }),
      'lexicon_get',
    ) as unknown[];
    return rows.map((r) => lexiconEntry.parse(r));
  }

  async getLevelRefs(lemmas: string[]): Promise<LevelRefs> {
    if (lemmas.length === 0) return { min_zipf: null, rows: [] };
    return check(
      await this.db.rpc('level_refs', { p_lemmas: lemmas.slice(0, 2000) }),
      'level_refs',
    ) as LevelRefs;
  }
}
