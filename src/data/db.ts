import Dexie, { type EntityTable } from 'dexie';
import type {
  Card,
  ChunkCacheRow,
  DailyActivity,
  ErrorLogRow,
  ImportCandidate,
  ImportJob,
  KnownTerm,
  LevelTest,
  LexiconSense,
  MetaRow,
  Note,
  OutboxRow,
  PracticeLog,
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
  practice_logs!: EntityTable<PracticeLog, 'id'>;
  level_tests!: EntityTable<LevelTest, 'id'>;
  known_terms!: EntityTable<KnownTerm, 'id'>;
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
    // v4 (v0.2 İP2): notes.level_override (null = the computed level) and level columns on
    // lexicon_cache rows (not indexed). Notes get null so the type holds (a local fill-in, not
    // stamped or queued; the server column defaults to null). The lexicon cursor goes back
    // to 0 so the next sync pulls the cached senses again, now with their levels.
    this.version(4)
      .stores({})
      .upgrade(async (tx) => {
        await tx
          .table('notes')
          .toCollection()
          .modify((row: { level_override?: string | null }) => {
            if (row.level_override === undefined) row.level_override = null;
          });
        await tx.table('meta').put({ key: 'lexicon_cursor', value: 0 });
      });
    // v9 (v0.2 İP3; 5–8 belong to other work packages): level_tests (insert-only) and
    // known_terms (synced, tombstones), and the level fields of settings. A level other than
    // the default B1 was chosen by the user, so it counts as 'manual' (a local fill-in, not
    // stamped or queued; the server columns have the same defaults). The sync cursor goes back
    // to 0 once: a server that already had these tables may have sent rows of them to this
    // device before it knew them (they were skipped), and they would never come again.
    this.version(9)
      .stores({
        level_tests: 'id, taken_at',
        known_terms: 'id, term_norm, deleted_at',
      })
      .upgrade(async (tx) => {
        await tx
          .table('settings')
          .toCollection()
          .modify((row: Record<string, unknown>) => {
            if (row.level_source === undefined) row.level_source = row.level !== 'B1' ? 'manual' : 'default';
            if (row.level_updated_at === undefined) row.level_updated_at = null;
            if (row.level_locked === undefined) row.level_locked = false;
            if (row.level_change === undefined) row.level_change = null;
          });
        await tx.table('meta').put({ key: 'sync_cursor', value: 0 });
      });
  }
}

export const db = new EngDb();
