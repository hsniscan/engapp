// "Farkı açıklat" (v0.3 İP6): one request to ai-contrast, its answer into the local cache,
// failures mapped to what the user can do. Sends only the two lexicon sense ids.
import { AiClientError, aiRequestError, type AiRequestError } from '@/ai/client';
import { suggestContrast, type ContrastRequest, type ContrastResponse } from '@/ai/contrast';
import { logError, storeContrastNote, type ContrastDraft } from '@/data';
import { getAccessToken, isBackendConfigured } from '@/lib/supabase';

export type ContrastRequestError = AiRequestError;

export type ContrastRequestResult = { ok: true; aiCalled: boolean } | { ok: false; error: ContrastRequestError };

export interface ContrastRequestDeps {
  suggest: (input: ContrastRequest) => Promise<ContrastResponse>;
  isOnline: () => boolean;
  isSignedIn: () => Promise<boolean>;
}

export const defaultContrastDeps: ContrastRequestDeps = {
  suggest: (input) => suggestContrast(input),
  isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine),
  isSignedIn: async () => isBackendConfigured() && (await getAccessToken()) !== null,
};

/** Ask ai-contrast for the pair's shared card and cache it; the draft then shows it (live). */
export async function requestContrast(
  draft: Pick<ContrastDraft, 'a' | 'b' | 'can_ask'>,
  deps: ContrastRequestDeps = defaultContrastDeps,
): Promise<ContrastRequestResult> {
  const a = draft.a.lexicon_sense_id;
  const b = draft.b.lexicon_sense_id;
  if (!draft.can_ask || !a || !b) return { ok: false, error: 'no_lexicon' };
  if (!(await deps.isSignedIn())) return { ok: false, error: 'signed_out' };
  if (!deps.isOnline()) return { ok: false, error: 'offline' };
  try {
    const res = await deps.suggest({ sense_ids: [a, b] });
    await storeContrastNote(res);
    return { ok: true, aiCalled: res.ai_called };
  } catch (e) {
    if (!(e instanceof AiClientError)) void logError(e, 'leech.contrast');
    return { ok: false, error: aiRequestError(e) };
  }
}
