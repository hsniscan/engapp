// Supabase side of the pronunciation pre-generation (scripts/tts-pregen.ts, decision 0042):
// reads the shared dictionary and the `tts` bucket, uploads MP3 files. Service role only.

import type { SupabaseClient } from '@supabase/supabase-js';
import { TTS_BUCKET, type TtsVoice } from '../../supabase/functions/_shared/tts-contract.ts';
import { TTS_BUCKET_MIME_TYPES } from '../../supabase/functions/_shared/tts-store.ts';
import { addToListing, emptyListing, type AudioListing } from './audio-r2.ts';
import type { PublicRows } from './tts-pregen.ts';

const PAGE = 1000;

export type BucketListing = AudioListing;

export class SupabasePregenStore {
  private readonly db: SupabaseClient;
  constructor(db: SupabaseClient) {
    this.db = db;
  }

  /** Every headword and active example sentence (keyset pages by id). */
  async publicRows(): Promise<PublicRows> {
    const terms: { lemma: string; lemma_norm: string }[] = [];
    for (let after = ''; ;) {
      let q = this.db.from('lexicon_terms').select('id, lemma, lemma_norm').order('id').limit(PAGE);
      if (after) q = q.gt('id', after);
      const { data, error } = await q;
      if (error) throw new Error(`lexicon_terms: ${error.message}`);
      const rows = (data ?? []) as { id: string; lemma: string; lemma_norm: string }[];
      terms.push(...rows);
      if (rows.length < PAGE) break;
      after = rows.at(-1)!.id;
    }
    const examples: { text_en: string }[] = [];
    for (let after = ''; ;) {
      let q = this.db
        .from('lexicon_examples')
        .select('id, text_en')
        .eq('status', 'active')
        .order('id')
        .limit(PAGE);
      if (after) q = q.gt('id', after);
      const { data, error } = await q;
      if (error) throw new Error(`lexicon_examples: ${error.message}`);
      const rows = (data ?? []) as { id: string; text_en: string }[];
      examples.push(...rows);
      if (rows.length < PAGE) break;
      after = rows.at(-1)!.id;
    }
    return { terms, examples };
  }

  /** English sentences of every approved graded text (decision 0047; keyset pages by id). */
  async gradedSentences(): Promise<string[]> {
    const out: string[] = [];
    for (let after = ''; ;) {
      let q = this.db
        .from('graded_texts')
        .select('id, sentences')
        .eq('status', 'approved')
        .order('id')
        .limit(200);
      if (after) q = q.gt('id', after);
      const { data, error } = await q;
      if (error) throw new Error(`graded_texts: ${error.message}`);
      const rows = (data ?? []) as { id: string; sentences: { en?: unknown }[] }[];
      for (const r of rows)
        for (const s of r.sentences ?? []) if (typeof s?.en === 'string') out.push(s.en);
      if (rows.length < 200) break;
      after = rows.at(-1)!.id;
    }
    return out;
  }

  /** What the bucket holds for these voices (names and sizes; files cannot be listed publicly). */
  async listBucket(voices: readonly TtsVoice[]): Promise<BucketListing> {
    const out: BucketListing = emptyListing();
    for (const voice of voices) {
      for (let offset = 0; ; offset += PAGE) {
        const { data, error } = await this.db.storage
          .from(TTS_BUCKET)
          .list(voice, { limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } });
        if (error) {
          if (/not found/i.test(error.message)) break; // no bucket yet
          throw new Error(`list ${voice}: ${error.message}`);
        }
        for (const f of data ?? []) {
          const size = Number((f.metadata as { size?: unknown } | null)?.size) || 0;
          addToListing(out, `${voice}/${f.name}`, size);
        }
        if ((data ?? []).length < PAGE) break;
      }
    }
    return out;
  }

  /** Creates the bucket, or lets it take MP3 files (if the migration could not). */
  async ensureBucket(): Promise<void> {
    const { data, error } = await this.db.storage.getBucket(TTS_BUCKET);
    if (error || !data) {
      const r = await this.db.storage.createBucket(TTS_BUCKET, {
        public: true,
        fileSizeLimit: 4 * 1024 * 1024,
        allowedMimeTypes: TTS_BUCKET_MIME_TYPES,
      });
      if (r.error && !/already exists/i.test(r.error.message)) {
        throw new Error(`create bucket: ${r.error.message}`);
      }
      return;
    }
    const allowed = data.allowed_mime_types;
    if (allowed && allowed.length > 0 && !allowed.includes('audio/mpeg')) {
      const r = await this.db.storage.updateBucket(TTS_BUCKET, {
        public: true,
        fileSizeLimit: data.file_size_limit ?? 4 * 1024 * 1024,
        allowedMimeTypes: TTS_BUCKET_MIME_TYPES,
      });
      if (r.error) throw new Error(`update bucket: ${r.error.message}`);
    }
  }

  /** Uploads one MP3 (three attempts). Content-addressed, so overwriting is harmless. */
  async upload(path: string, mp3: Uint8Array): Promise<void> {
    let last = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      const { error } = await this.db.storage
        .from(TTS_BUCKET)
        .upload(path, new Blob([mp3.slice()], { type: 'audio/mpeg' }), {
          contentType: 'audio/mpeg',
          cacheControl: '31536000',
          upsert: true,
        });
      if (!error) return;
      last = error.message;
    }
    throw new Error(`upload: ${last}`);
  }

  /** One object's bytes (service role; for the copy to R2, decision 0053). */
  async download(path: string): Promise<Uint8Array> {
    const { data, error } = await this.db.storage.from(TTS_BUCKET).download(path);
    if (error || !data) throw new Error(`download: ${error?.message ?? 'no data'}`);
    return new Uint8Array(await data.arrayBuffer());
  }

  async remove(paths: readonly string[]): Promise<number> {
    let removed = 0;
    for (let i = 0; i < paths.length; i += 100) {
      const chunk = paths.slice(i, i + 100);
      const { data, error } = await this.db.storage.from(TTS_BUCKET).remove([...chunk]);
      if (error) throw new Error(`remove: ${error.message}`);
      removed += data?.length ?? 0;
    }
    return removed;
  }
}
