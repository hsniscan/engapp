// POST /functions/v1/ai-extract — see docs/ai-pipeline.md for the contract.
import { runExtract } from '../_shared/extract.ts';
import { createAiFunction } from '../_shared/setup.ts';

Deno.serve(createAiFunction('ai-extract', (k) => Deno.env.get(k), runExtract));
