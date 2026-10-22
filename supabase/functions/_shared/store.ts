// Persistence used by the AI pipeline. SupabaseAiStore (supabase-store.ts) is the real
// implementation; tests use an in-memory one.

import type { Cefr, LevelSource } from './cefr.ts';
import type { LexiconEntry } from './contracts.ts';
import type { WordRefs } from './level.ts';

/** Level columns of a lexicon sense (v0.2 İP2); absent on rows from an older function. */
export interface LexLevel {
  cefr?: Cefr | null;
  cefr_source?: LevelSource | null;
  cefr_list?: Cefr | null;
  cefr_reason_tr?: string | null;
}

export interface LexSense extends LexLevel {
  id: string;
  pos: string;
  gloss_en: string;
  gloss_key: string;
  meaning_tr: string;
  ipa: string | null;
  updated_at: number;
}

export interface LexTerm {
  term_id: string;
  lemma: string;
  lemma_norm: string;
  term_type: 'word' | 'phrase' | 'pattern';
  zipf?: number | null;
  senses: LexSense[];
}

/** level_refs() row: a lemma's list entries (with the current correction) and frequency. */
export interface LevelRefRow extends WordRefs {
  lemma_norm: string;
}

export interface LevelRefs {
  /** Coverage of the frequency data (FreqCoverage.minZipf); null when none is loaded. */
  min_zipf: number | null;
  rows: LevelRefRow[];
}

export interface LexiconUpsertItem {
  lemma: string;
  lemma_norm: string;
  term_type: 'word' | 'phrase' | 'pattern';
  /** omit pos..gloss_key to upsert only the term */
  pos?: string;
  gloss_en?: string;
  gloss_key?: string;
  meaning_tr?: string;
  ipa?: string | null;
  model?: string | null;
  /** Level of a new sense (level.ts) and the term's Zipf value. */
  zipf?: number | null;
  cefr?: Cefr | null;
  cefr_source?: LevelSource | null;
  cefr_list?: Cefr | null;
  cefr_reason_tr?: string | null;
  cefr_guess?: Cefr | null;
}

export interface LexiconUpsertResult {
  term_id: string;
  sense_id: string | null;
  term_created: boolean;
  sense_created: boolean;
}

export interface CachedChunk {
  result: unknown;
  model: string | null;
}

export interface UsageResult {
  allowed: boolean;
  used: number;
  limit: number;
}

export interface AiStore {
  getChunkCache(
    userId: string,
    chunkHash: string,
    promptVersion: string,
    level: string,
  ): Promise<CachedChunk | null>;
  putChunkCache(
    userId: string,
    chunkHash: string,
    promptVersion: string,
    level: string,
    result: unknown,
    model: string | null,
  ): Promise<void>;
  /** Takes one call from the user's daily budget (atomic). */
  consumeAi(userId: string, limit: number): Promise<UsageResult>;
  /** Terms whose lemma_norm is in `norms`, with their senses. */
  findTerms(norms: string[]): Promise<LexTerm[]>;
  /** Insert-or-get, in input order. */
  upsertLexicon(items: LexiconUpsertItem[]): Promise<LexiconUpsertResult[]>;
  /** LexiconEntry rows by sense id (missing ids are omitted). */
  getEntries(ids: string[]): Promise<LexiconEntry[]>;
  /** Reference data (word lists, frequency) of up to 2000 lemmas; unknown lemmas are omitted. */
  getLevelRefs(lemmas: string[]): Promise<LevelRefs>;
}
