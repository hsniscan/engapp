// POST /functions/v1/ai-mnemonic — see docs/ai-mnemonic.md for the contract.
import { runMnemonic } from '../_shared/mnemonic.ts';
import { SupabasePairNoteStore } from '../_shared/pair-notes.ts';
import { createAiFunction } from '../_shared/setup.ts';
import { createAdminClient, loadServerConfig } from '../_shared/supabase-store.ts';

const env = (k: string) => Deno.env.get(k);
const pairNotes = new SupabasePairNoteStore(createAdminClient(loadServerConfig(env)));

Deno.serve(
  createAiFunction('ai-mnemonic', env, (body, deps) => runMnemonic(body, { ...deps, pairNotes })),
);
