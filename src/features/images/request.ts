// "Görsel üret" / "Yeniden üret" (v0.4 İP3): one call to ai-image for the user's sense; the
// new picture goes into the cache and becomes this sense's choice (the user asked for it).
// Sends only the lexicon sense id. Failures are mapped to what the user can do about them.
import { AiClientError } from '@/ai/client';
import { requestImage, type AiImageResponse } from '@/ai/image';
import { chooseImage, logError, storeImage } from '@/data';
import { toCachedImage } from '@/domain/images';
import type { Id } from '@/domain/types';
import type { SanitizeResult } from '../../../supabase/functions/_shared/image-contract';
import { getAccessToken, isBackendConfigured } from '@/lib/supabase';

/** The four reasons of the contract, plus what the device knows before asking. */
export type ImageRequestError =
  | 'daily_limit'
  | 'budget'
  | 'not_visual'
  | 'failed'
  | 'offline'
  | 'signed_out'
  | 'no_lexicon';

export type ImageRequestResult = { ok: true; imageId: Id } | { ok: false; error: ImageRequestError };

export interface ImageRequestDeps {
  request: (lexiconSenseId: Id) => Promise<AiImageResponse>;
  isOnline: () => boolean;
  isSignedIn: () => Promise<boolean>;
  now: () => number;
  sanitize?: (svg: string) => SanitizeResult;
}

export const defaultImageRequestDeps: ImageRequestDeps = {
  request: (id) => requestImage(id),
  isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine),
  isSignedIn: async () => isBackendConfigured() && (await getAccessToken()) !== null,
  now: () => Date.now(),
};

function errorOf(e: unknown): ImageRequestError {
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
    default:
      return 'failed';
  }
}

export async function drawImage(
  input: { senseId: Id; lexiconSenseId: Id | null },
  deps: ImageRequestDeps = defaultImageRequestDeps,
): Promise<ImageRequestResult> {
  if (!input.lexiconSenseId) return { ok: false, error: 'no_lexicon' };
  if (!(await deps.isSignedIn())) return { ok: false, error: 'signed_out' };
  if (!deps.isOnline()) return { ok: false, error: 'offline' };
  try {
    const res = await deps.request(input.lexiconSenseId);
    if (!res.ok) return { ok: false, error: res.reason };
    const cached = res.image.sense_id === input.lexiconSenseId ? toCachedImage(res.image, deps.now(), deps.sanitize) : null;
    if (!cached) return { ok: false, error: 'failed' };
    await storeImage(cached);
    await chooseImage(input.senseId, cached.id, deps.now());
    return { ok: true, imageId: cached.id };
  } catch (e) {
    if (!(e instanceof AiClientError)) void logError(e, 'images.request');
    return { ok: false, error: errorOf(e) };
  }
}
