// Wiring of the picture jobs for the command line (scripts/img-batch.ts, scripts/img-pilot.ts):
// Supabase service-role client, Claude client, Message Batches API, renderer. Secrets come from
// the environment only and are never printed; logs are JSON lines on stdout.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { claudeCall, createAnthropic } from '../../supabase/functions/_shared/image-claude.ts';
import { imageModels, monthlyCapUsd } from '../../supabase/functions/_shared/image-models.ts';
import { SupabaseImageStore } from '../../supabase/functions/_shared/image-store.ts';
import type { BatchApi, BatchResult, JobDeps, Log } from './image-jobs.ts';
import { loadRenderer } from './image-render.ts';

const env = (k: string): string | undefined => process.env[k] || undefined;

export const log: Log = (msg, data = {}) => {
  console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...data }));
};

/**
 * Without ANTHROPIC_API_KEY the jobs are skipped cleanly (exit 0), so the nightly workflow does
 * not fail before the owner adds the key. Returns false when the job should not run.
 */
export function haveClaudeKey(): boolean {
  if (env('ANTHROPIC_API_KEY')) return true;
  console.log(
    '::notice::ANTHROPIC_API_KEY is not set: picture job skipped (docs/setup-backend.md)',
  );
  return false;
}

function need(key: string): string {
  const v = env(key);
  if (!v) throw new Error(`${key} is not set`);
  return v;
}

export function serviceClient(): SupabaseClient {
  return createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function jobDepsFromEnv(): Promise<
  Omit<JobDeps, 'store'> & { db: SupabaseClient; store: SupabaseImageStore }
> {
  const db = serviceClient();
  // Long timeout: one Opus drawing with adaptive thinking can take minutes.
  const client = createAnthropic(env, { timeoutMs: 600_000 });
  const batches: BatchApi = {
    create: (requests) => client.messages.batches.create({ requests }),
    retrieve: (id) => client.messages.batches.retrieve(id),
    results: async (id) =>
      (await client.messages.batches.results(id)) as unknown as AsyncIterable<BatchResult>,
  };
  return {
    db,
    store: new SupabaseImageStore(db),
    claude: claudeCall(client),
    batches,
    models: imageModels(env),
    capUsd: monthlyCapUsd(env),
    render: await loadRenderer(),
    log,
  };
}
