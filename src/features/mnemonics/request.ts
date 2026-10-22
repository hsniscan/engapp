// "Öner" / "Başka öner" (v0.3 İP2): one request to ai-mnemonic, its answer into the local
// cache, failures mapped to what the user can do. Sends only the lexicon sense id.
import { AiClientError } from '@/ai/client';
import { suggestMnemonics, type MnemonicRequest, type MnemonicResponse } from '@/ai/mnemonic';
import { logError, storeMnemonicSuggestions } from '@/data';
import type { Id } from '@/domain/types';
import { getAccessToken, isBackendConfigured } from '@/lib/supabase';

export type MnemonicRequestError = 'offline' | 'signed_out' | 'daily_limit' | 'busy' | 'no_lexicon' | 'failed';

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

function requestError(e: unknown): MnemonicRequestError {
  if (!(e instanceof AiClientError)) return 'failed';
  switch (e.code) {
    case 'offline':
      return 'offline';
    case 'not_signed_in':
    case 'unauthorized':
    case 'not_configured':
      return 'signed_out';
    case 'daily_limit':
      return 'daily_limit';
    case 'quota_exceeded':
      return 'busy';
    default:
      return 'failed';
  }
}

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
    return { ok: false, error: requestError(e) };
  }
}
