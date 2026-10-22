// Client of the ai-contrast edge function (v0.3 İP6, docs/ai-contrast.md). Only two lexicon
// sense ids are sent: the server reads the words and meanings from the shared lexicon, so no
// user text can reach it.
import {
  CONTRAST_PROMPT_VERSION,
  contrastRequest,
  contrastResponse,
  type ContrastRequest,
  type ContrastResponse,
} from '../../supabase/functions/_shared/contrast-contracts';
import { type AiClientDeps, call } from './client';

export { CONTRAST_PROMPT_VERSION };
export type { ContrastRequest, ContrastResponse };

/** The shared contrast card of two lexicon senses: from the table when it exists (no AI call). */
export async function suggestContrast(input: ContrastRequest, deps: AiClientDeps = {}): Promise<ContrastResponse> {
  const body = contrastRequest.parse(input);
  return call('ai-contrast', body, (x) => contrastResponse.parse(x), { timeoutMs: 90_000, ...deps });
}
