// POST /functions/v1/ai-contrast — see docs/ai-contrast.md for the contract.
import { runContrast } from '../_shared/contrast.ts';
import { SupabasePairNoteStore } from '../_shared/pair-notes.ts';
import { createAiFunction } from '../_shared/setup.ts';
import { createAdminClient, loadServerConfig } from '../_shared/supabase-store.ts';

const env = (k: string) => Deno.env.get(k);
const pairNotes = new SupabasePairNoteStore(createAdminClient(loadServerConfig(env)));

Deno.serve(
  createAiFunction('ai-contrast', env, (body, deps) => runContrast(body, { ...deps, pairNotes })),
);
