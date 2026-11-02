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
import {
  forUser,
  SupabaseTextBudgetStore,
  textMonthlyCapUsd,
  textUserMonthlyCapUsd,
  type TextBudget,
} from './text-budget.ts';
import {
  pickedDailyLimit,
  runStory,
  storyDailyLimit,
  type StoryModel,
  type StoryStore,
} from './story.ts';
import { storyModelFromEnv } from './story-claude.ts';
import { SupabaseStoryStore } from './story-store.ts';

type Env = (key: string) => string | undefined;

/**
 * All text AI features of one user together, per UTC day (AI_DAILY_LIMIT). Was 200 until
 * v0.5.2; decision 0060 lowered it and added a limit per feature below.
 */
export const DEFAULT_AI_DAILY_LIMIT = 120;

export function dailyLimit(env: Env): number {
  const n = Number(env('AI_DAILY_LIMIT'));
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_AI_DAILY_LIMIT;
}

/**
 * Calls per user and UTC day of each text feature (decision 0060). Cache and dictionary hits
 * never count. Override one with AI_DAILY_LIMIT_<FEATURE>, e.g. AI_DAILY_LIMIT_EXTRACT=80.
 * ai-extract counts one call per text chunk, so reading two long articles fits in a day.
 */
export const DEFAULT_FEATURE_DAILY_LIMITS: Readonly<Record<string, number>> = {
  'ai-extract': 60,
  'ai-enrich': 60,
  'ai-themes': 10,
  'ai-mnemonic': 20,
  'ai-contrast': 20,
  'ai-report': 4,
  'ai-examples': 20,
};
const FALLBACK_FEATURE_DAILY_LIMIT = 20;

/** The daily limit of one feature (function name such as 'ai-extract'). */
export function featureDailyLimit(env: Env, name: string): number {
  const key = `AI_DAILY_LIMIT_${name.replace(/^ai-/, '').replace(/-/g, '_').toUpperCase()}`;
  const n = Number(env(key));
  if (Number.isInteger(n) && n > 0) return n;
  return DEFAULT_FEATURE_DAILY_LIMITS[name] ?? FALLBACK_FEATURE_DAILY_LIMIT;
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
  const limit = dailyLimit(env);
  // The feature's own daily counter next to the shared one (decision 0060).
  const store =
    overrides.store ??
    new SupabaseAiStore(admin!, { feature: name, featureLimit: featureDailyLimit(env, name) });
  // The Claude fallback spends from the monthly text budget, shared with the library jobs,
  // and from the calling user's monthly share of it.
  const capUsd = textMonthlyCapUsd(env);
  const userCapUsd = textUserMonthlyCapUsd(env, capUsd);
  const budget: TextBudget | undefined = admin
    ? { store: new SupabaseTextBudgetStore(admin), capUsd }
    : undefined;
  const authenticate = overrides.authenticate ?? createAuthenticator(cfg!);
  const logger = log(name);
  // Gemini, then Claude Haiku on quota exhaustion (decision 0044). One provider per request:
  // the budget it carries names the user who pays.
  const providerFor = (userId: string): (() => AiProvider) => {
    if (overrides.provider) return overrides.provider;
    let provider: AiProvider | null = null;
    return () =>
      (provider ??= createTextAiProvider(env, {
        log: logger,
        ...(budget ? { budget: forUser(budget, userId, userCapUsd) } : {}),
      }));
  };
  return createHandler({
    cors: { allowedOrigins: parseOrigins(env('ALLOWED_ORIGINS')) },
    authenticate,
    log: logger,
    run: (body, userId) =>
      run(body, { userId, store, provider: providerFor(userId), dailyLimit: limit, log: logger }),
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
  const capUsd = textMonthlyCapUsd(env);
  const userCapUsd = textUserMonthlyCapUsd(env, capUsd);
  const budget: TextBudget | null =
    overrides.budget !== undefined
      ? overrides.budget
      : { store: new SupabaseTextBudgetStore(admin!), capUsd };
  const authenticate = overrides.authenticate ?? createAuthenticator(cfg!);
  const logger = log('ai-story');
  const model = overrides.model !== undefined ? overrides.model : storyModelFromEnv(env, logger);
  const limit = storyDailyLimit(env);
  const picked = pickedDailyLimit(env);
  return createHandler({
    cors: { allowedOrigins: parseOrigins(env('ALLOWED_ORIGINS')) },
    authenticate,
    log: logger,
    run: (body, userId) =>
      runStory(body, {
        userId,
        store,
        model,
        // Every story call also counts against this user's monthly share (decision 0060).
        ...(budget ? { budget: budget.user ? budget : forUser(budget, userId, userCapUsd) } : {}),
        dailyLimit: limit,
        pickedDailyLimit: picked,
        log: logger,
      }),
  });
}
