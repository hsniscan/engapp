// Wiring of the graded library job for the command line (scripts/graded-batch.ts): service-role
// Supabase client, Claude Message Batches API, models, the monthly Claude budget
// (CLAUDE_MONTHLY_CREDIT_USD) with the library's own cap (GRADED_MONTHLY_USD, decision 0073)
// from the environment, the level file from the repository.

import { readFileSync } from 'node:fs';
import { createAnthropic } from '../../supabase/functions/_shared/image-claude.ts';
import {
  DEFAULT_GRADED_MODEL,
  imageModels,
  monthlyCapUsd,
} from '../../supabase/functions/_shared/image-models.ts';
import { parseLevelTable, type LevelTable } from '../../supabase/functions/_shared/graded-coverage.ts';
import {
  CappedBudgetStore,
  ClaudeMonthlyBudgetStore,
  gradedMonthlyCapUsd,
  monthStartIso,
} from './graded-budget.ts';
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
  budgetStore: CappedBudgetStore;
} {
  const env: Env = (k) => process.env[k] || undefined;
  const db = serviceClient();
  const store = new SupabaseGradedStore(db);
  const budgetStore = new CappedBudgetStore(new ClaudeMonthlyBudgetStore(db), {
    capUsd: gradedMonthlyCapUsd(env),
    spentUsd: () => store.monthSpendUsd(monthStartIso()),
  });
  return {
    store,
    budget: { store: budgetStore, capUsd: monthlyCapUsd(env) },
    budgetStore,
    batches: withClaude ? batchApi(env) : noBatches,
    models: gradedModels(env),
    levels: loadLevelTable(),
    log,
  };
}
