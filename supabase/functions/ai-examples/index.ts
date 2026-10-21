// POST /functions/v1/ai-examples — see docs/ai-pipeline.md ("ai-examples") for the contract.
import { runExamples } from '../_shared/examples.ts';
import { SupabaseExampleStore } from '../_shared/examples-store.ts';
import { createAiFunction } from '../_shared/setup.ts';
import { createAdminClient, loadServerConfig } from '../_shared/supabase-store.ts';

const env = (k: string) => Deno.env.get(k);
const examples = new SupabaseExampleStore(createAdminClient(loadServerConfig(env)));

Deno.serve(
  createAiFunction('ai-examples', env, (body, deps) => runExamples(body, { ...deps, examples })),
);
