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
import { SupabaseTextBudgetStore, textMonthlyCapUsd, type TextBudget } from './text-budget.ts';
import { runStory, storyDailyLimit, type StoryModel, type StoryStore } from './story.ts';
import { storyModelFromEnv } from './story-claude.ts';
import { SupabaseStoryStore } from './story-store.ts';

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
  const admin = cfg ? createAdminClient(cfg) : null;
  const store = overrides.store ?? new SupabaseAiStore(admin!);
  // The Claude fallback spends from the monthly text budget, shared with the library jobs.
  const budget: TextBudget | undefined = admin
    ? { store: new SupabaseTextBudgetStore(admin), capUsd: textMonthlyCapUsd(env) }
    : undefined;
  const authenticate = overrides.authenticate ?? createAuthenticator(cfg!);
  const logger = log(name);
  let provider: AiProvider | null = null;
  // Gemini, then Claude Haiku on quota exhaustion (decision 0044).
  const getProvider =
    overrides.provider ??
    (() =>
      (provider ??= createTextAiProvider(env, { log: logger, ...(budget ? { budget } : {}) })));
  const limit = dailyLimit(env);
  return createHandler({
    cors: { allowedOrigins: parseOrigins(env('ALLOWED_ORIGINS')) },
    authenticate,
    log: logger,
    run: (body, userId) =>
      run(body, { userId, store, provider: getProvider, dailyLimit: limit, log: logger }),
  });
}

export interface StoryOverrides {
  store?: StoryStore;
  model?: (() => StoryModel) | null;
  authenticate?: (req: Request) => Promise<string>;
  /** null: no budget (tests); absent: the monthly text budget in Supabase. */
  budget?: TextBudget | null;
}

/**
 * ai-story (decision 0050): a signed-in Google account, the story's own daily counter
 * (STORY_DAILY_LIMIT) and Claude Haiku (CLAUDE_STORY_MODEL) under the monthly text budget
 * (CLAUDE_TEXT_MONTHLY_USD), every call through recordTextSpend.
 */
export function createStoryFunction(
  env: Env,
  overrides: StoryOverrides = {},
): (req: Request) => Promise<Response> {
  const needsDb = !overrides.store || !overrides.authenticate || overrides.budget === undefined;
  const cfg = needsDb ? loadServerConfig(env) : null;
  const admin = cfg ? createAdminClient(cfg) : null;
  const store = overrides.store ?? new SupabaseStoryStore(admin!);
  const budget: TextBudget | null =
    overrides.budget !== undefined
      ? overrides.budget
      : { store: new SupabaseTextBudgetStore(admin!), capUsd: textMonthlyCapUsd(env) };
  const authenticate = overrides.authenticate ?? createAuthenticator(cfg!);
  const logger = log('ai-story');
  const model = overrides.model !== undefined ? overrides.model : storyModelFromEnv(env, logger);
  const limit = storyDailyLimit(env);
  return createHandler({
    cors: { allowedOrigins: parseOrigins(env('ALLOWED_ORIGINS')) },
    authenticate,
    log: logger,
    run: (body, userId) =>
      runStory(body, {
        userId,
        store,
        model,
        ...(budget ? { budget } : {}),
        dailyLimit: limit,
        log: logger,
      }),
  });
}
