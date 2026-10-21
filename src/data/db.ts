import Dexie, { type EntityTable } from 'dexie';
import type {
  Card,
  ChunkCacheRow,
  DailyActivity,
  ErrorLogRow,
  ImportCandidate,
  ImportJob,
  LexiconSense,
  MetaRow,
  Note,
  OutboxRow,
  ReviewLog,
  Sense,
  Settings,
  Source,
} from '../domain/types';

/**
 * Local database. The source of truth for the UI: screens read and write only here,
 * the sync engine and AI client work in the background and write their results here.
 *
 * Schema changes: bump the version, add an upgrade() and a test (AGENTS.md rule 9).
 */
export class EngDb extends Dexie {
  notes!: EntityTable<Note, 'id'>;
  senses!: EntityTable<Sense, 'id'>;
  cards!: EntityTable<Card, 'id'>;
  review_logs!: EntityTable<ReviewLog, 'id'>;
  sources!: EntityTable<Source, 'id'>;
  settings!: EntityTable<Settings, 'id'>;
  lexicon_cache!: EntityTable<LexiconSense, 'id'>;
  chunk_cache!: EntityTable<ChunkCacheRow, 'chunk_hash'>;
  import_jobs!: EntityTable<ImportJob, 'id'>;
  import_candidates!: EntityTable<ImportCandidate, 'id'>;
  outbox!: EntityTable<OutboxRow, 'seq'>;
  daily_activity!: EntityTable<DailyActivity, 'date'>;
  error_log!: EntityTable<ErrorLogRow, 'id'>;
  meta!: EntityTable<MetaRow, 'key'>;

  constructor(name = 'engapp') {
    super(name);
    this.version(1).stores({
      notes: 'id, &term_norm, lexicon_term_id, updated_at, deleted_at, *tags',
      senses: 'id, note_id, &[note_id+lexicon_sense_id], lexicon_sense_id, deleted_at',
      cards: 'id, note_id, sense_id, [state+due], due, card_type, deleted_at',
      review_logs: 'id, card_id, reviewed_at, undo_of',
      sources: 'id, created_at',
      settings: 'id',
      lexicon_cache: 'id, term_id, lemma_norm, updated_at',
      chunk_cache: 'chunk_hash, created_at',
      import_jobs: 'id, status, created_at',
      import_candidates: 'id, job_id',
      outbox: '++seq, [table+row_id], next_attempt_at',
      daily_activity: 'date',
      error_log: '++id, at',
      meta: 'key',
    });
  }
}

export const db = new EngDb();
