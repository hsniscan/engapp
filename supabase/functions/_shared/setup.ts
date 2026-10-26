// Wires an edge function from environment variables. Environment-neutral: the caller
// passes an env getter (Deno.env.get in production, a map in tests/local runs).

import type { AiProvider } from './ai-provider.ts';
import { createTextAiProvider } from './ai.ts';
import { createHandler, parseOrigins } from './http.ts';
import { log } from './log.ts';
import type { PipelineDeps } from './extract.ts';
import type { AiStore } from './store.ts';
import {
  createAdminClient,
  createAuthenticator,
  loadServerConfig,
  SupabaseAiStore,
} from './supabase-store.ts';

type Env = (key: string) => string | undefined;

export const DEFAULT_AI_DAILY_LIMIT = 200;

export function dailyLimit(env: Env): number {
  const n = Number(env('AI_DAILY_LIMIT'));
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_AI_DAILY_LIMIT;
}

export { log } from './log.ts';

export interface FunctionOverrides {
  store?: AiStore;
  provider?: () => AiProvider;
  authenticate?: (req: Request) => Promise<string>;
}

export function createAiFunction<T>(
  name: string,
  env: Env,
  run: (body: unknown, deps: PipelineDeps) => Promise<T>,
  overrides: FunctionOverrides = {},
): (req: Request) => Promise<Response> {
  const cfg = overrides.store && overrides.authenticate ? null : loadServerConfig(env);
  const store = overrides.store ?? new SupabaseAiStore(createAdminClient(cfg!));
  const authenticate = overrides.authenticate ?? createAuthenticator(cfg!);
  const logger = log(name);
  let provider: AiProvider | null = null;
  // Gemini, then Claude Haiku on quota exhaustion (decision 0044).
  const getProvider =
    overrides.provider ?? (() => (provider ??= createTextAiProvider(env, { log: logger })));
  const limit = dailyLimit(env);
  return createHandler({
    cors: { allowedOrigins: parseOrigins(env('ALLOWED_ORIGINS')) },
    authenticate,
    log: logger,
    run: (body, userId) =>
      run(body, { userId, store, provider: getProvider, dailyLimit: limit, log: logger }),
  });
}
