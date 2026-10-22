// POST /functions/v1/ai-report — see docs/ai-report.md for the contract.
import { runReport } from '../_shared/report.ts';
import { createAiFunction } from '../_shared/setup.ts';

Deno.serve(createAiFunction('ai-report', (k) => Deno.env.get(k), runReport));
