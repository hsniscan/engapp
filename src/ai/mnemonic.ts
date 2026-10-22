// Client of the ai-mnemonic edge function (v0.3 İP2, docs/ai-mnemonic.md). Only a lexicon
// sense id and the "Başka öner" flag are sent: the server reads the word from the shared
// lexicon and the earlier suggestions from the shared table, so no user text can reach it.
import {
  MNEMONIC_PROMPT_VERSION,
  mnemonicRequest,
  mnemonicResponse,
  type MnemonicRequest,
  type MnemonicResponse,
} from '../../supabase/functions/_shared/mnemonic-contracts';
import { type AiClientDeps, call } from './client';

export { MNEMONIC_PROMPT_VERSION };
export type { MnemonicRequest, MnemonicResponse };

/**
 * Mnemonic suggestions for one lexicon sense: the shared ones when the sense has some (no AI
 * call), else 0–2 new ones. With `more`, new ones unlike the stored ones ("Başka öner").
 */
export async function suggestMnemonics(input: MnemonicRequest, deps: AiClientDeps = {}): Promise<MnemonicResponse> {
  const body = mnemonicRequest.parse(input);
  return call('ai-mnemonic', body, (x) => mnemonicResponse.parse(x), { timeoutMs: 90_000, ...deps });
}
