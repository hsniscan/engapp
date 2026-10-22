// Wiring of the word-bank job for the command line (scripts/word-bank.ts): service-role
// Supabase client, Claude Message Batches API, model and monthly cap from the environment.

import { createAnthropic } from '../../supabase/functions/_shared/image-claude.ts';
import { imageModels, monthlyCapUsd } from '../../supabase/functions/_shared/image-models.ts';
import { log, serviceClient } from './image-env.ts';
import type { BatchApi, BatchResult } from './image-jobs.ts';
import type { WordBankDeps } from './word-bank-jobs.ts';
import { SupabaseWordBankStore } from './word-bank-store.ts';

type Env = (key: string) => string | undefined;

/**
 * The word bank's model: CLAUDE_WORDBANK_MODEL, else the check model (CLAUDE_CHECK_MODEL, a
 * Haiku by default). Never hard-coded here (AGENTS.md rule 5).
 */
export function wordBankModel(env: Env): string {
  return env('CLAUDE_WORDBANK_MODEL')?.trim() || imageModels(env).check;
}

export async function wordBankDepsFromEnv(): Promise<
  WordBankDeps & { store: SupabaseWordBankStore }
> {
  const env: Env = (k) => process.env[k] || undefined;
  const client = createAnthropic(env, { timeoutMs: 600_000 });
  const batches: BatchApi = {
    create: (requests) => client.messages.batches.create({ requests }),
    retrieve: (id) => client.messages.batches.retrieve(id),
    results: async (id) =>
      (await client.messages.batches.results(id)) as unknown as AsyncIterable<BatchResult>,
  };
  return {
    store: new SupabaseWordBankStore(serviceClient()),
    batches,
    model: wordBankModel(env),
    capUsd: monthlyCapUsd(env),
    log,
  };
}
