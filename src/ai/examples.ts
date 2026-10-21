// Client of the ai-examples edge function (v0.2 İP5, docs/ai-pipeline.md "ai-examples").
// Only lexicon sense ids, a level band and context keys are sent: the server reads term,
// part of speech and gloss from the shared lexicon itself, so no user text can reach it.
import {
  EXAMPLES_PROMPT_VERSION,
  examplesRequest,
  examplesResponse,
  type ExamplesRequest,
  type ExamplesResponse,
} from '../../supabase/functions/_shared/examples-contracts';
import { type AiClientDeps, call } from './client';

export { EXAMPLES_PROMPT_VERSION };
export type { ExamplesRequest, ExamplesResponse };

/**
 * Example sentences for up to 8 lexicon senses in the given contexts (cache first; the model
 * writes only the missing (sense, context) pairs). With `fresh`, one new sentence for that
 * sense and context, unlike the existing ones ("Yenisini üret").
 */
export async function generateExamples(
  input: ExamplesRequest,
  deps: AiClientDeps = {},
): Promise<ExamplesResponse> {
  const body = examplesRequest.parse(input);
  return call('ai-examples', body, (x) => examplesResponse.parse(x), { timeoutMs: 90_000, ...deps });
}
