import Dexie, { type EntityTable } from 'dexie';
import type {
  Card,
  ChunkCacheRow,
  ContentFeedback,
  DailyActivity,
  ErrorLogRow,
  ExampleJob,
  ImportCandidate,
  ImportJob,
  LexiconExample,
  LexiconSense,
  MetaRow,
  Note,
  OutboxRow,
  PracticeLog,
  ReviewLog,
  Sense,
  Settings,
  Source,
  UserContent,
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
  practice_logs!: EntityTable<PracticeLog, 'id'>;
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
  lexicon_examples!: EntityTable<LexiconExample, 'id'>;
  content_feedback!: EntityTable<ContentFeedback, 'id'>;
  user_content!: EntityTable<UserContent, 'id'>;
  example_jobs!: EntityTable<ExampleJob, 'key'>;

  constructor(name = 'engapp') {
    super(name);
    // term_norm and [note_id+lexicon_sense_id] are deliberately NOT unique indexes: an
    // account merge or a sync pull may bring a second note with the same term (it is kept
    // and flagged possible_duplicate). Uniqueness among live rows is enforced in actions.ts.
    this.version(1).stores({
      notes: 'id, term_norm, lexicon_term_id, updated_at, deleted_at, *tags',
      senses: 'id, note_id, [note_id+lexicon_sense_id], lexicon_sense_id, deleted_at',
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
    // v2: senses.source_sentence_tr and import_candidates.source_sentence_tr (not indexed).
    // Existing rows get null so the type holds; this is a local fill-in, not an edit, so it
    // is not stamped or queued (the server column defaults to null as well).
    this.version(2)
      .stores({})
      .upgrade(async (tx) => {
        for (const table of ['senses', 'import_candidates']) {
          await tx
            .table(table)
            .toCollection()
            .modify((row: { source_sentence_tr?: string | null }) => {
              if (row.source_sentence_tr === undefined) row.source_sentence_tr = null;
            });
        }
      });
    // v3 (v0.2 İP1): practice_logs, insert-only and synced. Practice answers never feed FSRS.
    // Meta keys `extra_new:<day>` hold today's extra new-card allowance (no schema change).
    this.version(3).stores({ practice_logs: 'id, card_id, practiced_at, session_id' });
    // (v4 belongs to v0.2 İP2.)
    // v5 (v0.2 İP5): example sentences. lexicon_examples is a read-only cache of the shared
    // table (like lexicon_cache); content_feedback and user_content are synced, per user;
    // example_jobs is the device-local preparation queue. New tables only: no upgrade().
    this.version(5).stores({
      lexicon_examples: 'id, sense_id, [sense_id+level_band], updated_at',
      content_feedback: 'id, [target_kind+target_id], deleted_at',
      user_content: 'id, kind, lexicon_sense_id, replaces_id, deleted_at',
      example_jobs: 'key, status, next_attempt_at',
    });
  }
}

export const db = new EngDb();
