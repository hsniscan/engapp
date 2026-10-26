// Wiring of the graded library job for the command line (scripts/graded-batch.ts): service-role
// Supabase client, Claude Message Batches API, models and the text budget's cap from the
// environment, the level file from the repository.

import { readFileSync } from 'node:fs';
import { createAnthropic } from '../../supabase/functions/_shared/image-claude.ts';
import { DEFAULT_GRADED_MODEL, imageModels } from '../../supabase/functions/_shared/image-models.ts';
import { parseLevelTable, type LevelTable } from '../../supabase/functions/_shared/graded-coverage.ts';
import {
  SupabaseTextBudgetStore,
  textMonthlyCapUsd,
} from '../../supabase/functions/_shared/text-budget.ts';
import { log, serviceClient } from './image-env.ts';
import type { BatchApi, BatchResult } from './image-jobs.ts';
import type { GradedDeps, GradedModels } from './graded-jobs.ts';
import { SupabaseGradedStore } from './graded-store.ts';

type Env = (key: string) => string | undefined;

/**
 * Writer: CLAUDE_GRADED_MODEL (default Sonnet); checker: CLAUDE_CHECK_MODEL (default Haiku).
 * Never hard-coded here (AGENTS.md rule 5).
 */
export function gradedModels(env: Env): GradedModels {
  return {
    writer: env('CLAUDE_GRADED_MODEL')?.trim() || DEFAULT_GRADED_MODEL,
    check: imageModels(env).check,
  };
}

const LEVELS_FILE = new URL('../../data/levels/client-levels.tsv', import.meta.url);

export function loadLevelTable(): LevelTable {
  return parseLevelTable(readFileSync(LEVELS_FILE, 'utf8'));
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

const noBatches: BatchApi = {
  create: () => Promise.reject(new Error('no Claude key: nothing may be sent')),
  retrieve: () => Promise.reject(new Error('no Claude key')),
  results: () => Promise.reject(new Error('no Claude key')),
};

/** The job's wiring; `withClaude` false (plan, report, dry runs) needs no Claude key. */
export function gradedDepsFromEnv(withClaude: boolean): GradedDeps & {
  store: SupabaseGradedStore;
  budgetStore: SupabaseTextBudgetStore;
} {
  const env: Env = (k) => process.env[k] || undefined;
  const db = serviceClient();
  const budgetStore = new SupabaseTextBudgetStore(db);
  return {
    store: new SupabaseGradedStore(db),
    budget: { store: budgetStore, capUsd: textMonthlyCapUsd(env) },
    budgetStore,
    batches: withClaude ? batchApi(env) : noBatches,
    models: gradedModels(env),
    levels: loadLevelTable(),
    log,
  };
}
