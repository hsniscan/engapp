// POST /functions/v1/ai-themes — see docs/ai-pipeline.md ("ai-themes") for the contract.
import { runThemes } from '../_shared/themes.ts';
import { createAiFunction } from '../_shared/setup.ts';

Deno.serve(createAiFunction('ai-themes', (k) => Deno.env.get(k), runThemes));
