// Shared entity types. Pure TypeScript: no React, Dexie or network imports in domain/.
// Field names match the Supabase columns (snake_case) so rows sync without mapping.

export type Id = string; // UUID v7, generated on the client
export type Millis = number; // UTC epoch milliseconds

/** Columns every synced row carries. */
export interface SyncedRow {
  id: Id;
  user_id: string | null; // null while in guest mode
  created_at: Millis;
  updated_at: Millis;
  deleted_at: Millis | null; // tombstone; purged after 30 days
  hlc: string; // hybrid logical clock, see domain/hlc.ts
}

export type TermType = 'word' | 'phrase' | 'pattern';
export type CardType = 'recognition' | 'production' | 'cloze';

/** FSRS card states (numeric values match ts-fsrs State enum). */
export const CardState = { New: 0, Learning: 1, Review: 2, Relearning: 3 } as const;
export type CardStateValue = (typeof CardState)[keyof typeof CardState];

/** Answer ratings (numeric values match ts-fsrs Rating enum). */
export const Rating = { Again: 1, Hard: 2, Good: 3, Easy: 4 } as const;
export type RatingValue = (typeof Rating)[keyof typeof Rating];

/** A word or phrase the user is learning. One note per term_norm per user. */
export interface Note extends SyncedRow {
  term: string; // display form, dictionary form ("give up")
  term_norm: string; // lower-case normalized form, unique per user
  term_type: TermType;
  lexicon_term_id: Id | null;
  ipa: string | null; // copied from lexicon or entered by hand
  tags: string[];
  possible_duplicate: boolean; // set when an account merge finds two notes with same term
}

/** One meaning of a note ("1. banka", "2. kıyı"). */
export interface Sense extends SyncedRow {
  note_id: Id;
  sense_no: number; // display order, 1-based
  lexicon_sense_id: Id | null; // null when added offline / by hand without lexicon match
  pos: string | null; // part of speech
  gloss_en: string | null; // short English definition that tells senses apart
  meaning_tr: string; // Turkish meaning (from lexicon or typed)
  meaning_tr_override: string | null; // user's correction; wins over lexicon
  source_sentence: string | null;
  /** The user's Turkish translation of source_sentence. Per user, never in the lexicon. */
  source_sentence_tr: string | null;
  span: [number, number] | null; // [start, end) char offsets of the term in source_sentence
  source_id: Id | null;
}

export interface FsrsFields {
  due: Millis;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: CardStateValue;
  last_review: Millis | null;
}

export interface Card extends SyncedRow, FsrsFields {
  note_id: Id;
  sense_id: Id | null; // null for recognition cards (they belong to the note)
  card_type: CardType;
  suspended: boolean;
  /** Production/cloze cards stay locked until the note's recognition card reaches Review. */
  unlocked: boolean;
}

/** Immutable answer record. Never updated or deleted (undo adds a new row with undo_of). */
export interface ReviewLog {
  id: Id;
  user_id: string | null;
  card_id: Id;
  rating: RatingValue;
  reviewed_at: Millis;
  duration_ms: number; // capped at 60 000
  device_id: string;
  undo_of: Id | null; // when set, this row cancels the log with that id
  shown_sense_id: Id | null; // recognition card: which sense's sentence was shown
  created_at: Millis;
  hlc: string;
}

export interface Source extends SyncedRow {
  kind: 'text' | 'pdf';
  title: string;
  file_name: string | null;
  page_count: number | null;
}

export type ThemePref = 'system' | 'light' | 'dark';
export type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

/** One settings row per user (id = 'settings'). */
export interface Settings extends SyncedRow {
  daily_new_limit: number; // default 10
  request_retention: number; // 0.80–0.95, default 0.90
  timezone: string; // IANA, e.g. Europe/Istanbul
  day_start_hour: number; // default 4
  theme: ThemePref;
  voice: 'en-US' | 'en-GB';
  level: CefrLevel; // self-estimated, default B1
  fsrs_params: number[] | null; // null = ts-fsrs defaults
  last_backup_at: Millis | null;
}

/** Shared dictionary entries, read-only on the client (pulled from server). */
export interface LexiconSense {
  id: Id; // lexicon_sense_id
  term_id: Id;
  lemma: string;
  lemma_norm: string;
  term_type: TermType;
  pos: string;
  gloss_en: string;
  meaning_tr: string;
  ipa: string | null;
  updated_at: Millis;
}

export type ImportJobStatus = 'queued' | 'processing' | 'ready' | 'failed' | 'done';

export interface ImportJob {
  id: Id;
  source_id: Id;
  status: ImportJobStatus;
  chunk_total: number;
  chunk_done: number;
  cache_hits: number; // chunks served from chunk_cache + candidates matched to existing lexicon senses
  error: string | null;
  created_at: Millis;
  updated_at: Millis;
}

export type CandidateMatch = 'known_sense' | 'new_sense' | 'new_term';
/** Relationship to the user's own notes. */
export type CandidateUserStatus = 'new' | 'add_sense' | 'exists';

export interface ImportCandidate {
  id: Id;
  job_id: Id;
  term: string;
  surface: string;
  term_type: TermType;
  lexicon_sense_id: Id | null;
  match: CandidateMatch;
  pos: string | null;
  gloss_en: string | null;
  meaning_tr: string | null;
  ipa: string | null;
  source_sentence: string;
  source_sentence_tr: string | null; // AI translation of source_sentence (null on older results)
  span: [number, number];
  confidence: number;
  selected: boolean;
  user_status: CandidateUserStatus;
  meaning_tr_edit: string | null; // user's in-place correction in preview
}

export interface ChunkCacheRow {
  chunk_hash: string;
  result: unknown; // validated AiExtractResult
  created_at: Millis;
}

export type OutboxTable = 'notes' | 'senses' | 'cards' | 'review_logs' | 'sources' | 'settings';

export interface OutboxRow {
  seq?: number; // auto-increment key
  table: OutboxTable;
  row_id: Id;
  op: 'upsert' | 'delete';
  payload: unknown;
  attempts: number;
  next_attempt_at: Millis;
}

/** Local, derived cache (rebuildable from review_logs). Undone logs never count. */
export interface DailyActivity {
  date: string; // local YYYY-MM-DD (day starts at day_start_hour)
  reviews: number; // all answers
  new_cards: number; // answers given to a card in state New (first introduction)
  time_ms: number;
  review_answers: number; // answers given while the card was in state Review (retention base)
  review_passed: number; // of those, answers other than Again
  completed: boolean; // no due card was left over at the end of that day
}

export interface ErrorLogRow {
  id?: number;
  at: Millis;
  message: string;
  stack: string | null;
  context: string | null;
}

/** Key/value device metadata (device_id, sync_cursor, lexicon_cursor, schema_version, ...). */
export interface MetaRow {
  key: string;
  value: unknown;
}
