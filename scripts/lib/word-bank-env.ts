// Wiring of the word-bank job for the command line (scripts/word-bank.ts): service-role
// Supabase client, Claude Message Batches API, model and monthly cap from the environment.

import { createAnthropic } from '../../supabase/functions/_shared/image-claude.ts';
import {
  DEFAULT_WORDBANK_REVIEW_MODEL,
  imageModels,
  monthlyCapUsd,
} from '../../supabase/functions/_shared/image-models.ts';
import { log, serviceClient } from './image-env.ts';
import type { BatchApi, BatchResult } from './image-jobs.ts';
import type { WordBankDeps } from './word-bank-jobs.ts';
import type { ReviewDeps } from './word-bank-review.ts';
import { SupabaseWordBankReviewStore, SupabaseWordBankStore } from './word-bank-store.ts';

type Env = (key: string) => string | undefined;

/**
 * The word bank's model: CLAUDE_WORDBANK_MODEL, else the check model (CLAUDE_CHECK_MODEL, a
 * Haiku by default). Never hard-coded here (AGENTS.md rule 5).
 */
export function wordBankModel(env: Env): string {
  return env('CLAUDE_WORDBANK_MODEL')?.trim() || imageModels(env).check;
}

/**
 * The review pass's model (decision 0040): CLAUDE_WORDBANK_REVIEW_MODEL, else the default in
 * _shared/image-models.ts (Claude Sonnet 5.5).
 */
export function wordBankReviewModel(env: Env): string {
  return env('CLAUDE_WORDBANK_REVIEW_MODEL')?.trim() || DEFAULT_WORDBANK_REVIEW_MODEL;
}

function batchApi(env: Env): BatchApi {
  const client = createAnthropic(env, { timeoutMs: 600_000 });
  return {
    create: (requests) => client.messages.batches.create({ requests }),
    retrieve: (id) => client.messages.batches.retrieve(id),
    results: async (id) =>
      (await client.messages.batches.results(id)) as unknown as AsyncIterable<BatchResult>,
  };
}

/** The review's wiring; `withClaude` false (a dry run) needs no Claude key. */
export function reviewDepsFromEnv(withClaude: boolean): Omit<ReviewDeps, 'batches'> & {
  batches: BatchApi | null;
  store: SupabaseWordBankReviewStore;
} {
  const env: Env = (k) => process.env[k] || undefined;
  return {
    store: new SupabaseWordBankReviewStore(serviceClient()),
    batches: withClaude ? batchApi(env) : null,
    model: wordBankReviewModel(env),
    capUsd: monthlyCapUsd(env),
    log,
  };
}

export async function wordBankDepsFromEnv(): Promise<
  WordBankDeps & { store: SupabaseWordBankStore }
> {
  const env: Env = (k) => process.env[k] || undefined;
  return {
    store: new SupabaseWordBankStore(serviceClient()),
    batches: batchApi(env),
    model: wordBankModel(env),
    capUsd: monthlyCapUsd(env),
    log,
  };
}
