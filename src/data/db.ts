import Dexie, { type EntityTable } from 'dexie';
import type {
  AnkiImportRecord,
  Card,
  ChunkCacheRow,
  ContentFeedback,
  DailyActivity,
  Deck,
  ErrorLogRow,
  ExampleJob,
  ImportCandidate,
  ImportJob,
  LexiconExample,
  LexiconPairNote,
  KnownTerm,
  LevelTest,
  LexiconSense,
  MetaRow,
  Note,
  OutboxRow,
  PracticeLog,
  RefCacheRow,
  ReviewLog,
  Sense,
  Settings,
  Source,
  UserContent,
  ThemePreview,
  ReportDraft,
  WeeklyReport,
} from '../domain/types';
import type { CachedImage } from '../domain/images';
import type { WordBankEntry } from '../domain/wordBank';
import type { EncounterRow, ReaderText } from '../domain/texts';
import type { GradedBody, GradedCatalogEntry } from '../domain/library';
import { addPullBackfill } from './backfill';

/**
 * Meta key of the one-time Bugün note "Öğrenilmiş sayma kuralı değişti" (ADR 0041): false =
 * still to show (set by the v26 upgrade on devices that had cards), true = seen, absent = never.
 */
export const STAGE_RULE_NOTICE_KEY = 'stage_rule_v1_seen';

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
  decks!: EntityTable<Deck, 'id'>;
  theme_previews!: EntityTable<ThemePreview, 'id'>;
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
  lexicon_examples!: EntityTable<LexiconExample, 'id'>;
  content_feedback!: EntityTable<ContentFeedback, 'id'>;
  user_content!: EntityTable<UserContent, 'id'>;
  example_jobs!: EntityTable<ExampleJob, 'key'>;
  ref_cache!: EntityTable<RefCacheRow, 'key'>;
  anki_imports!: EntityTable<AnkiImportRecord, 'id'>;
  lexicon_pair_notes!: EntityTable<LexiconPairNote, 'id'>;
  weekly_reports!: EntityTable<WeeklyReport, 'id'>;
  report_drafts!: EntityTable<ReportDraft, 'week'>;
  images!: EntityTable<CachedImage, 'id'>;
  word_bank!: EntityTable<WordBankEntry, 'id'>;
  texts!: EntityTable<ReaderText, 'id'>;
  encounters!: EntityTable<EncounterRow, 'id'>;
  graded_catalog!: EntityTable<GradedCatalogEntry, 'id'>;
  graded_bodies!: EntityTable<GradedBody, 'id'>;

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
    // v5 (v0.2 İP5): example sentences. lexicon_examples is a read-only cache of the shared
    // table (like lexicon_cache); content_feedback and user_content are synced, per user;
    // example_jobs is the device-local preparation queue. An older app version that pulled
    // content_feedback / user_content rows (sync_pull_v3 returns every registered table)
    // dropped them as invalid: re-pull those two tables once (data/backfill.ts).
    this.version(5)
      .stores({
        lexicon_examples: 'id, sense_id, [sense_id+level_band], updated_at',
        content_feedback: 'id, [target_kind+target_id], deleted_at',
        user_content: 'id, kind, lexicon_sense_id, replaces_id, deleted_at',
        example_jobs: 'key, status, next_attempt_at',
      })
      .upgrade((tx) => addPullBackfill(tx.table('meta'), ['content_feedback', 'user_content']));
    // v6 (v0.2 İP6, word families): ref_cache keeps the lazily
    // fetched morphology file for offline use; pair_note_feedback held the user's "gizle" /
    // "bildir" on false-friend warnings (device-local; replaced in v8, see there). Notes may now have term_type 'affix'. An older app
    // version skipped such a pulled note as invalid and moved its cursor past it; if this
    // device logged one, pull again from the start so the note arrives (rows are merged by
    // HLC, so a repeated pull changes nothing else).
    this.version(6)
      .stores({ ref_cache: 'key', pair_note_feedback: 'key, verdict' })
      .upgrade(async (tx) => {
        const skippedNote = await tx
          .table('error_log')
          .filter((r: { context?: string | null }) => !!r.context?.startsWith('sync.pull invalid notes/'))
          .count();
        if (skippedNote > 0) await tx.table('meta').put({ key: 'sync_cursor', value: 0 });
      });
    // v7 (v0.2 İP7): sources.topics (multi-entry index, for "texts about this topic") and
    // settings.interests / settings.muted_topics (not indexed). All optional: an absent list
    // means "unknown", so existing rows need no upgrade.
    this.version(7).stores({ sources: 'id, created_at, *topics' });
    // v8 (v0.2 İP8): decks (synced, mutable) and the local
    // theme-grouping preview. A device that has pulled before may have skipped deck rows
    // written by a newer device while it ran an older version: re-pull them once.
    // Also (v0.2 batch 1): pair_note_feedback is dropped. False-friend "gizle" / "hatalı" are
    // content_feedback rows now (synced, per account); v6 was never released, so no device
    // has rows to carry over.
    this.version(8)
      .stores({ decks: 'id, sort, deleted_at', theme_previews: 'id', pair_note_feedback: null })
      .upgrade((tx) => addPullBackfill(tx.table('meta'), ['decks']));
    // v9 (v0.2 İP3): level_tests (insert-only) and known_terms (synced, tombstones), and the
    // level fields of settings. A level other than the default B1 was chosen by the user, so
    // it counts as 'manual' (a local fill-in, not stamped or queued; the server columns have
    // the same defaults). A device that has pulled before may have skipped rows of the two
    // tables while it ran an older version: re-pull them once (data/backfill.ts, the same
    // mechanism as v5 and v8; built as a one-time sync-cursor reset, unified when merged).
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
            if (row.level_source === undefined)
              row.level_source = row.level !== undefined && row.level !== 'B1' ? 'manual' : 'default';
            if (row.level_updated_at === undefined) row.level_updated_at = null;
            if (row.level_locked === undefined) row.level_locked = false;
            if (row.level_change === undefined) row.level_change = null;
          });
        await addPullBackfill(tx.table('meta'), ['level_tests', 'known_terms']);
      });
    // v10 (v0.2 İP4; versions 5–9 belong to the other v0.2 packages): smart-extraction fields
    // on the local import_candidates rows (not indexed). Rows of jobs from before keep their
    // selection: "zaten var" rows go to "Biliyorsun", the others to "Senin için", level
    // unknown. Settings rows need nothing: a missing show_easy_candidates means false.
    this.version(10)
      .stores({})
      .upgrade(async (tx) => {
        await tx
          .table('import_candidates')
          .toCollection()
          .modify((row: Partial<ImportCandidate>) => {
            row.cefr ??= null;
            row.cefr_source ??= null;
            row.bucket ??= row.user_status === 'exists' ? 'known' : 'for_you';
            row.from_list ??= false;
          });
      });
    // v11 (v0.2 batch 1 review): columns, not tables, an older version dropped. While this
    // device ran v0.1/İP1 it pulled notes, settings and sources written by an updated device
    // and stripped the newer columns (a level the user set, the level test's source and lock,
    // interests, topics); v4/v9 then filled them with their unset values under the same HLC.
    // Re-pull these tables once: rows with an equal HLC take the server's set values
    // (domain/syncMerge.ts), so the device shows them and its next edit does not push the
    // unset values over them.
    this.version(11)
      .stores({})
      .upgrade((tx) => addPullBackfill(tx.table('meta'), ['notes', 'settings', 'sources']));
    // v12 (v0.3 İP1, Anki import; versions 13–20 belong to the other v0.3 packages):
    // anki_imports keeps each import's counts and its "Sözlükle eşleştir" queue (local only).
    // review_logs.origin ('anki' for imported answers) is optional and not indexed: absent
    // means 'app', so existing logs need no fill-in (and logs are never rewritten). sources
    // may now have kind 'anki': an older app version dropped such a pulled source as invalid,
    // so re-pull sources once.
    this.version(12)
      .stores({ anki_imports: 'id, created_at' })
      .upgrade((tx) => addPullBackfill(tx.table('meta'), ['sources']));
    // v13 (v0.3 İP2; versions 12 and 14–20 belong to the other v0.3 packages, Dexie allows
    // gaps): lexicon_pair_notes, a read-only cache of the shared table (like lexicon_cache):
    // mnemonic suggestions from ai-mnemonic and AI false friends from extract-v5. The user's
    // own mnemonic is a user_content row (kind 'mnemonic', already synced) and import jobs
    // collect their chunks' topics in import_jobs.chunk_topics (not indexed): no row upgrade.
    this.version(13).stores({ lexicon_pair_notes: 'id, [sense_id+kind], term_norm' });
    // v14 (v0.3 İP3, load management; versions 12–20 belong to the v0.3 packages): the
    // settings row gains daily_capacity_min, catchup_auto, vacation and vacation_history (not
    // indexed, all optional: absent means the default, so no row is rewritten). While this
    // device ran an older version it may have pulled a settings row with these columns and
    // dropped them; re-pull settings once so a vacation set on another device arrives
    // (equal HLC → the server's set values win, domain/syncMerge.ts).
    this.version(14)
      .stores({})
      .upgrade((tx) => addPullBackfill(tx.table('meta'), ['settings']));
    // v15 (v0.3 İP4; versions 12–14 and 16+ belong to the other v0.3 packages): the optional
    // settings fsrs_params_prev and fsrs_opt_at (not indexed; absent = nothing to revert, never
    // ran). A device that pulled the settings row while it ran an older version stripped them
    // under the same HLC: re-pull settings once so "Eski ayara dön" and the monthly offer see
    // them (domain/syncMerge.ts takes the set values).
    this.version(15)
      .stores({})
      .upgrade((tx) => addPullBackfill(tx.table('meta'), ['settings']));
    // v17 (v0.3 İP8; 12–20 belong to the v0.3 packages): settings.notify, the daily reminder
    // (not indexed; absent = off). A device that ran an older version while another device
    // turned reminders on dropped the column when it pulled settings: re-pull settings once
    // so it shows the reminder as on (rows with an equal HLC take the server's value,
    // domain/syncMerge.ts).
    this.version(17)
      .stores({})
      .upgrade((tx) => addPullBackfill(tx.table('meta'), ['settings']));
    // v19 (v0.3 İP6, leeches and contrast cards; 12–20 belong to the v0.3 packages): notes may
    // now have term_type 'contrast' ("affect ↔ effect", recognition card only). An older app
    // version skipped such a pulled note as invalid and moved its cursor past it: re-pull
    // notes once (equal HLC rows merge without change, domain/syncMerge.ts). Reported and
    // hidden confusable pairs and a contrast card's difference line are user_content rows
    // (kinds 'confusion' and 'contrast', already synced); shared contrast content is cached
    // in lexicon_pair_notes (kind 'contrast'): no new table or index.
    this.version(19)
      .stores({})
      .upgrade((tx) => addPullBackfill(tx.table('meta'), ['notes']));
    // v20 (v0.3 İP7; 12–20 belong to the v0.3 packages): weekly reports and goals.
    // weekly_reports is synced and insert-only (one row per week; the server keeps the first);
    // report_drafts holds this device's report while its AI comment has not come yet (local
    // only, cleared with the account's data). settings.goals is an optional column (absent =
    // no goals). A device that pulled while it ran an older version dropped both: re-pull them
    // once (data/backfill.ts; equal HLC → the server's set values, domain/syncMerge.ts).
    this.version(20)
      .stores({ weekly_reports: 'id, week', report_drafts: 'week' })
      .upgrade((tx) => addPullBackfill(tx.table('meta'), ['settings', 'weekly_reports']));
    // v21 (v0.4 İP3, pictures; 22+ belong to the other v0.4 packages): `images` caches the
    // shared pictures of the user's lexicon senses (read-only, like lexicon_pair_notes; not
    // synced, kept within ~20 MB, see domain/images.ts). The user's picture choice, hide flag
    // and verdicts are user_content / content_feedback rows (already synced). The settings row
    // gains show_image_front (optional, absent = off): a device that pulled settings while it
    // ran an older version dropped it, so re-pull settings once (equal HLC → the server's set
    // value, domain/syncMerge.ts).
    this.version(21)
      .stores({ images: 'id, sense_id, fetched_at' })
      .upgrade((tx) => addPullBackfill(tx.table('meta'), ['settings']));
    // v22 (v0.4 İP8, picture recall cards; 23+ belong to the other v0.4 packages): cards may
    // now have card_type 'image' and the settings row gains image_cards (optional, absent =
    // on). No new table or index. An older app version dropped a pulled picture card as
    // invalid and stripped image_cards from settings: re-pull both once (equal HLC → the
    // server's set values, domain/syncMerge.ts). The picture cards of senses whose pictures are
    // already cached are made after start-up (data/imageCards.ts reconcileImageCards needs the
    // sync writer, which an upgrade transaction cannot use).
    this.version(22)
      .stores({})
      .upgrade((tx) => addPullBackfill(tx.table('meta'), ['cards', 'settings']));
    // v24 (v0.4 wave 2, Kelime Bankası, decision 0038; 22, 23 and 25 belong to the other
    // packages): `word_bank`, the device's copy of public.word_bank (shared system content,
    // read-only like lexicon_cache; pulled by server_seq into meta.word_bank_cursor). A new
    // table and nothing synced changes, so no row is rewritten.
    this.version(24).stores({ word_bank: 'id, cefr, lemma_norm' });
    // v25 (v0.4 smart new-card order, docs/decisions/0039; 22–24 belong to other v0.4
    // packages): the settings row gains new_card_order (optional, absent = 'smart'). A device
    // that pulled settings while it ran an older version dropped it: re-pull settings once
    // (equal HLC → the server's set value, domain/syncMerge.ts). No new table or index.
    this.version(25)
      .stores({})
      .upgrade((tx) => addPullBackfill(tx.table('meta'), ['settings']));
    // v26 (redesign, learning model, docs/decisions/0041; 27 is the reserve): cards gain
    // ramp_step and learned_at. Both are derived from the review logs, so the upgrade only
    // gives existing rows the "unset" values (0, null) and leaves the real values to the
    // one-off replay after start-up (data/maintenance.ts backfillLearningModel), which needs
    // the scheduler and the sync writer. No re-pull: no older app version stored them. A
    // device that already has cards gets the one-time "the counting rule changed" note on
    // Bugün (meta stage_rule_v1_seen = false); a fresh install does not.
    this.version(26)
      .stores({})
      .upgrade(async (tx) => {
        let cards = 0;
        await tx
          .table('cards')
          .toCollection()
          .modify((row: { ramp_step?: number; learned_at?: number | null }) => {
            cards++;
            if (row.ramp_step === undefined) row.ramp_step = 0;
            if (row.learned_at === undefined) row.learned_at = null;
          });
        if (cards > 0) await tx.table('meta').put({ key: STAGE_RULE_NOTICE_KEY, value: false });
      });
    // v28 (v0.5 reading texts, decision 0043; 26–27 belong to the UI redesign, 29–36 to the
    // other v0.5 packages): `texts`, the user's reading texts (domain/texts.ts), and
    // `encounters`, how often the user met each note per day and source. Both are new tables,
    // so no row is rewritten.
    this.version(28).stores({
      texts: 'id, kind, updated_at, deleted_at, graded_id',
      encounters: 'id, note_id, day',
    });
    // v31 (v0.5 graded library, decision 0047; 29, 30 and 32 belong to the other v0.5
    // packages): `graded_catalog`, the device's copy of the approved texts' metadata (shared
    // system content, read-only like word_bank; pulled by server_seq into
    // meta.graded_cursor), and `graded_bodies`, the sentences of each text the user opened
    // (kept for offline reading). Both are new tables, so no row is rewritten.
    this.version(31).stores({
      graded_catalog: 'id, level, topic, server_seq',
      graded_bodies: 'id, fetched_at',
    });
    // v33 (v0.5 study modes, decision 0051; 32 and 34–36 belong to the other v0.5 packages):
    // cards may now have card_type 'dictation' ("Dikte"). No new table or index. An older app
    // version dropped a pulled dictation card as invalid: re-pull cards once (equal HLC → the
    // server's row, domain/syncMerge.ts), so a device never makes a fresh copy of a dictation
    // card another device already studied. The cards themselves are made after start-up
    // (data/dictation.ts reconcileDictationCards needs the sync writer).
    this.version(33)
      .stores({})
      .upgrade((tx) => addPullBackfill(tx.table('meta'), ['cards']));
  }
}

export const db = new EngDb();
