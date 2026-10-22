// Client for the `tts` edge function (server pronunciation audio, docs/decisions/0028).
// The answer is validated with the server's own schema. Errors are AiClientError, like the
// other AI calls; callers fall back to the browser's speech engine on any of them.

import {
  ttsRequest,
  ttsResponse,
  type TtsResponse,
  type TtsVoice,
} from '../../supabase/functions/_shared/tts-contract';
import { errorBody } from '../../supabase/functions/_shared/contracts';
import { backendConfig, getAccessToken } from '@/lib/supabase';
import { AiClientError, type AiClientDeps } from './client';

export type { TtsResponse, TtsVoice };

/** Asks the server for the audio of `text`. Default timeout 25 s (a person is waiting). */
export async function requestPronunciation(
  text: string,
  voice: TtsVoice,
  deps: AiClientDeps = {},
): Promise<TtsResponse> {
  const body = ttsRequest.parse({ text, voice });
  const config = deps.config === undefined ? backendConfig : deps.config;
  if (!config) throw new AiClientError('not_configured', 'Supabase is not configured');
  const token = await (deps.getAccessToken ?? getAccessToken)();
  if (!token) throw new AiClientError('not_signed_in', 'Sign in for server pronunciation');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), deps.timeoutMs ?? 25_000);
  let res: Response;
  let json: unknown;
  try {
    res = await (deps.fetch ?? fetch)(`${config.url}/functions/v1/tts`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        apikey: config.key,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    json = await res.json().catch(() => null);
  } catch (e) {
    throw new AiClientError('offline', e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const err = errorBody.safeParse(json);
    throw err.success
      ? new AiClientError(err.data.error.code, err.data.error.message, res.status)
      : new AiClientError(
          res.status === 401 ? 'unauthorized' : 'internal',
          `HTTP ${res.status}`,
          res.status,
        );
  }
  const ok = ttsResponse.safeParse(json);
  if (!ok.success) throw new AiClientError('bad_response', 'invalid tts response', res.status);
  return ok.data;
}
