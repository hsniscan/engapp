// Real TtsStore: SQL functions from migration 20261024000100_tts.sql (service role) and the
// public `tts` Storage bucket (pre-generated MP3 and on-demand WAV, decisions 0028 and 0042).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { TtsStore, TtsTextSource } from './tts.ts';
import { TTS_BUCKET, ttsPublicUrl } from './tts-contract.ts';

export { TTS_BUCKET };

/** Audio types the bucket accepts (migration 20261027000100_tts_mp3.sql). */
export const TTS_BUCKET_MIME_TYPES = ['audio/wav', 'audio/mpeg'];

/** Content type of an object in the bucket, from its extension. */
export function ttsContentType(path: string): string {
  return path.endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav';
}

export class SupabaseTtsStore implements TtsStore {
  private readonly db: SupabaseClient;
  private readonly baseUrl: string;
  constructor(db: SupabaseClient, supabaseUrl: string) {
    this.db = db;
    this.baseUrl = supabaseUrl.replace(/\/$/, '');
  }

  async textSource(userId: string, text: string): Promise<TtsTextSource | null> {
    const r = await this.db.rpc('tts_text_source', { p_user: userId, p_text: text });
    if (r.error) throw new Error(`tts_text_source: ${r.error.message}`);
    return r.data === 'public' || r.data === 'private' ? r.data : null;
  }

  async consume(userId: string, limit: number) {
    const r = await this.db.rpc('tts_consume', { p_user: userId, p_limit: limit });
    if (r.error) throw new Error(`tts_consume: ${r.error.message}`);
    return r.data as { allowed: boolean; used: number; limit: number };
  }

  async exists(path: string): Promise<boolean> {
    // HEAD on the object through the service role (not the public CDN URL, which may cache a 404).
    const { data, error } = await this.db.storage.from(TTS_BUCKET).exists(path);
    return !error && data === true;
  }

  async upload(path: string, audio: Uint8Array): Promise<boolean> {
    const contentType = ttsContentType(path);
    const put = () =>
      this.db.storage
        .from(TTS_BUCKET)
        .upload(path, new Blob([audio.slice()], { type: contentType }), {
          contentType,
          // Content-addressed (the path is a hash of version + voice + text): never changes.
          cacheControl: '31536000',
          upsert: true,
        });
    let { error } = await put();
    if (error && /bucket not found/i.test(error.message)) {
      // The migration normally creates the bucket; create it here if it could not.
      await this.db.storage.createBucket(TTS_BUCKET, {
        public: true,
        fileSizeLimit: 4 * 1024 * 1024,
        allowedMimeTypes: TTS_BUCKET_MIME_TYPES,
      });
      ({ error } = await put());
    }
    if (error) {
      console.log(JSON.stringify({ fn: 'tts', msg: 'upload failed', error: error.message }));
    }
    return !error;
  }

  publicUrl(path: string): string {
    return ttsPublicUrl(this.baseUrl, path);
  }
}
