// Persistence of shared example sentences (public.lexicon_examples, migration
// 20261022000100_examples.sql). Service role only: clients read the table through RLS and
// lexicon_examples_pull, never write it. Tests use testing/memory-example-store.ts.

import type { SupabaseClient } from '@supabase/supabase-js';
import { lexiconExample, type LevelBand, type LexiconExampleRow } from './examples-contracts.ts';

export interface NewExample {
  sense_id: string;
  context: string;
  level_band: LevelBand;
  text_en: string;
  span: [number, number];
  translations: Record<string, string>;
  model: string | null;
  prompt_version: string;
}

export interface ExampleStore {
  /** Active examples of these senses; `band` null = every band. */
  findExamples(senseIds: string[], band: LevelBand | null): Promise<LexiconExampleRow[]>;
  /**
   * Insert-or-skip, in input order: a sentence that equals (normalised) one the sense
   * already has is not inserted again (unique (sense_id, text_key)). Returns the new rows.
   */
  insertExamples(items: NewExample[]): Promise<LexiconExampleRow[]>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function check<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
}

export class SupabaseExampleStore implements ExampleStore {
  private readonly db: SupabaseClient;
  constructor(db: SupabaseClient) {
    this.db = db;
  }

  async findExamples(senseIds: string[], band: LevelBand | null): Promise<LexiconExampleRow[]> {
    const ids = senseIds.filter((id) => UUID.test(id));
    if (ids.length === 0) return [];
    const rows = check(
      await this.db.rpc('lexicon_examples_find', { p_sense_ids: ids, p_band: band }),
      'lexicon_examples_find',
    ) as unknown[];
    return rows.map((r) => lexiconExample.parse(r));
  }

  async insertExamples(items: NewExample[]): Promise<LexiconExampleRow[]> {
    if (items.length === 0) return [];
    const rows = check(
      await this.db.rpc('lexicon_examples_insert', { p_items: items }),
      'lexicon_examples_insert',
    ) as unknown[];
    return rows.map((r) => lexiconExample.parse(r));
  }
}
