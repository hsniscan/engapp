// POST /functions/v1/ai-extract — see docs/ai-pipeline.md for the contract.
import { runExtract } from '../_shared/extract.ts';
import { SupabasePairNoteStore } from '../_shared/pair-notes.ts';
import { createAiFunction } from '../_shared/setup.ts';
import { createAdminClient, loadServerConfig } from '../_shared/supabase-store.ts';

const env = (k: string) => Deno.env.get(k);
// extract-v5: AI false friends of new senses go to lexicon_pair_notes (decision 0020).
const pairNotes = new SupabasePairNoteStore(createAdminClient(loadServerConfig(env)));

Deno.serve(createAiFunction('ai-extract', env, (body, deps) => runExtract(body, { ...deps, pairNotes })));
