// The `tts` function's audio on Cloudflare R2 (decision 0053), in front of Supabase Storage.
// Environment-neutral: the R2 client and the Supabase store are passed in.
//
//   find: R2 first (HEAD), then Supabase Storage (files not copied yet keep serving);
//   save: R2 (cache-on-miss), and Supabase Storage only when the R2 upload fails.
// Any R2 error is logged and falls through to Supabase, so R2 trouble never breaks audio.

import type { R2Client } from './r2.ts';
import { audioObjectUrl } from './tts-contract.ts';
import type { TtsStore } from './tts.ts';
import { ttsContentType } from './tts-store.ts';

/** Cache header of every audio object: content-addressed names never change. */
export const AUDIO_CACHE_CONTROL = 'public, max-age=31536000, immutable';

type Log = (msg: string, data?: Record<string, unknown>) => void;

export function withR2Audio(
  base: TtsStore,
  r2: Pick<R2Client, 'head' | 'put'>,
  publicBaseUrl: string,
  log?: Log,
): TtsStore {
  return {
    textSource: (userId, text) => base.textSource(userId, text),
    consume: (userId, limit) => base.consume(userId, limit),

    async find(path) {
      try {
        if (await r2.head(path)) return audioObjectUrl(publicBaseUrl, path);
      } catch (e) {
        log?.('tts r2 head failed', { error: e instanceof Error ? e.message : String(e) });
      }
      return base.find(path);
    },

    async save(path, audio) {
      try {
        await r2.put(path, audio, {
          contentType: ttsContentType(path),
          cacheControl: AUDIO_CACHE_CONTROL,
        });
        return audioObjectUrl(publicBaseUrl, path);
      } catch (e) {
        log?.('tts r2 upload failed', { error: e instanceof Error ? e.message : String(e) });
        return base.save(path, audio);
      }
    },
  };
}
