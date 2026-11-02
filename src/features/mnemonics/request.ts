// "Öner" / "Başka öner" (v0.3 İP2): one request to ai-mnemonic, its answer into the local
// cache, failures mapped to what the user can do. Sends only the lexicon sense id.
import { AiClientError, aiRequestError, type AiRequestError } from '@/ai/client';
import { suggestMnemonics, type MnemonicRequest, type MnemonicResponse } from '@/ai/mnemonic';
import { logError, storeMnemonicSuggestions } from '@/data';
import type { Id } from '@/domain/types';
import { getAccessToken, isBackendConfigured } from '@/lib/supabase';

export type MnemonicRequestError = AiRequestError;

export type MnemonicRequestResult =
  | { ok: true; newIds: Id[]; none: boolean; exhausted: boolean; aiCalled: boolean }
  | { ok: false; error: MnemonicRequestError };

export interface MnemonicRequestDeps {
  suggest: (input: MnemonicRequest) => Promise<MnemonicResponse>;
  isOnline: () => boolean;
  isSignedIn: () => Promise<boolean>;
}

export const defaultMnemonicDeps: MnemonicRequestDeps = {
  suggest: (input) => suggestMnemonics(input),
  isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine),
  isSignedIn: async () => isBackendConfigured() && (await getAccessToken()) !== null,
};

export async function requestMnemonics(
  input: { lexiconSenseId: Id | null; termNorm: string; more: boolean },
  deps: MnemonicRequestDeps = defaultMnemonicDeps,
): Promise<MnemonicRequestResult> {
  if (!input.lexiconSenseId) return { ok: false, error: 'no_lexicon' };
  if (!(await deps.isSignedIn())) return { ok: false, error: 'signed_out' };
  if (!deps.isOnline()) return { ok: false, error: 'offline' };
  try {
    const res = await deps.suggest({ sense_id: input.lexiconSenseId, more: input.more });
    await storeMnemonicSuggestions(res, input.termNorm);
    return { ok: true, newIds: res.new_ids, none: res.none, exhausted: res.exhausted, aiCalled: res.ai_called };
  } catch (e) {
    if (!(e instanceof AiClientError)) void logError(e, 'mnemonics.request');
    return { ok: false, error: aiRequestError(e) };
  }
}
