// POST /functions/v1/ai-enrich — see docs/ai-pipeline.md for the contract.
import { runEnrich } from '../_shared/enrich.ts';
import { createAiFunction } from '../_shared/setup.ts';

Deno.serve(createAiFunction('ai-enrich', (k) => Deno.env.get(k), runEnrich));
