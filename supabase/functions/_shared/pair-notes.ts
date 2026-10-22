// Shared notes on a lexicon sense in a language pair (public.lexicon_pair_notes, migrations
// 20261022000200_word_family.sql and 20261023000200_mnemonics.sql): AI false friends from
// extract-v5 and mnemonic suggestions from ai-mnemonic. Service role only: clients read the
// table through RLS, never write it. Never holds user text or user ids.
// Tests use testing/memory-pair-note-store.ts.

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

export const PAIR_NOTE_KINDS = ['false_friend', 'mnemonic_suggestion'] as const;
export type PairNoteKind = (typeof PAIR_NOTE_KINDS)[number];
export type LangPair = 'en-tr';

/** A shared pair note as the functions return it (updated_at in epoch ms). */
export const lexiconPairNote = z.object({
  id: z.string(),
  term_norm: z.string(),
  /** lexicon_senses.id; null for a note about the term as a whole (hand-written false friends). */
  sense_id: z.string().nullable(),
  lang_pair: z.literal('en-tr'),
  kind: z.enum(PAIR_NOTE_KINDS),
  content_key: z.string(),
  content: z.record(z.string(), z.unknown()),
  curated: z.boolean(),
  status: z.enum(['active', 'retired']),
  updated_at: z.number(),
});
export type LexiconPairNoteRow = z.infer<typeof lexiconPairNote>;

export interface NewPairNote {
  term_norm: string;
  sense_id: string;
  lang_pair: LangPair;
  kind: PairNoteKind;
  content_key: string;
  content: Record<string, unknown>;
  model: string | null;
  prompt_version: string;
}

export interface PairNoteStore {
  /** Active notes of this kind on these senses, oldest first. */
  findNotes(senseIds: string[], kind: PairNoteKind): Promise<LexiconPairNoteRow[]>;
  /**
   * Insert-or-skip, in input order: a note with the same (pair, kind, term, sense, content
   * key) is not stored twice. Returns the new rows.
   */
  insertNotes(items: NewPairNote[]): Promise<LexiconPairNoteRow[]>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function check<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
}

export class SupabasePairNoteStore implements PairNoteStore {
  private readonly db: SupabaseClient;
  constructor(db: SupabaseClient) {
    this.db = db;
  }

  async findNotes(senseIds: string[], kind: PairNoteKind): Promise<LexiconPairNoteRow[]> {
    const ids = senseIds.filter((id) => UUID.test(id));
    if (ids.length === 0) return [];
    const rows = check(
      await this.db.rpc('lexicon_pair_notes_find', { p_sense_ids: ids, p_kind: kind }),
      'lexicon_pair_notes_find',
    ) as unknown[];
    return rows.map((r) => lexiconPairNote.parse(r));
  }

  async insertNotes(items: NewPairNote[]): Promise<LexiconPairNoteRow[]> {
    if (items.length === 0) return [];
    const rows = check(
      await this.db.rpc('lexicon_pair_notes_insert', { p_items: items }),
      'lexicon_pair_notes_insert',
    ) as unknown[];
    return rows.map((r) => lexiconPairNote.parse(r));
  }
}
