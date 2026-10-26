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
/**
 * A note can also be a root or affix card ("-spect-", "re-") or a contrast card for two
 * terms the learner mixes up ("affect ↔ effect", v0.3 İP6): recognition card only.
 */
export type NoteTermType = TermType | 'affix' | 'contrast';

/** Notes with only a recognition card (no production or cloze cards for their senses). */
export const recognitionOnly = (t: NoteTermType): boolean => t === 'affix' || t === 'contrast';
/**
 * 'image' (v0.4 İP8, decision 0036): the sense's picture on the front, the English word to
 * recall. One per sense with an approved (or chosen) picture; locked like production.
 */
export type CardType = 'recognition' | 'production' | 'cloze' | 'image';

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
  term_type: NoteTermType;
  lexicon_term_id: Id | null;
  ipa: string | null; // copied from lexicon or entered by hand
  tags: string[];
  possible_duplicate: boolean; // set when an account merge finds two notes with same term
  /** The user's own level for this word; null = the computed one (src/domain/level.ts). */
  level_override: CefrLevel | null;
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
  /**
   * Counted reviews since graduation or the last lapse (the "sağlam tekrar" counter of the
   * learning model, docs/decisions/0041). Derived from the logs by replay; drives the ramp caps
   * and the word stages (domain/stages.ts).
   */
  ramp_step: number;
  /** First time the card reached Öğrenildi (never cleared by a later lapse). Derived by replay. */
  learned_at: Millis | null;
}

export interface Card extends SyncedRow, FsrsFields {
  note_id: Id;
  sense_id: Id | null; // null for recognition cards (they belong to the note)
  card_type: CardType;
  suspended: boolean;
  /** Production/cloze/image cards stay locked until the note's recognition card reaches Review. */
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
  /**
   * Where the answer was given (v0.3 İP1): 'anki' = imported from an Anki revlog. Absent or
   * null = 'app' (rows written before the column, and every answer given here).
   */
  origin?: ReviewLogOrigin | null;
}

export type ReviewLogOrigin = 'app' | 'anki';

/** "Bildim" / "Bilemedim" in a practice round. */
export type PracticeResult = 'known' | 'unknown';

/**
 * One answer in a practice round ("Pratik turu"). Insert-only like review logs, but it NEVER
 * feeds FSRS, the queue, daily_activity or the streak; only practice selection and stats.
 */
export interface PracticeLog {
  id: Id;
  user_id: string | null;
  card_id: Id;
  practiced_at: Millis;
  result: PracticeResult;
  /** Where the round's cards came from: 'hard' | 'recent' | 'tag' (newer clients may add more). */
  mode: string;
  /** One id per round. */
  session_id: Id;
  duration_ms: number; // capped at 60 000
  device_id: string;
  created_at: Millis;
  hlc: string;
}

/** One answered word of a level test (domain/levelTest.ts TestItem). */
export interface LevelTestItem {
  w: string;
  band: CefrLevel | null;
  pseudo: boolean;
  answer: 'yes' | 'no';
  mc_ok?: boolean;
}

/** A finished level test. Insert-only; study history (never copied between accounts). */
export interface LevelTest {
  id: Id;
  user_id: string | null;
  taken_at: Millis;
  result_level: CefrLevel;
  vocab_estimate: number;
  reliable: boolean;
  false_alarm_rate: number;
  /** Corrected share of known words per level (all six, untested ones inferred). */
  ratios: Record<CefrLevel, number>;
  items: LevelTestItem[];
  bank_version: string;
  /** The result was made the user's level. */
  applied: boolean;
  duration_ms: number;
  device_id: string;
  created_at: Millis;
  hlc: string;
}

/** A category of the weekly report (domain/retention.ts groups), with its counted answers. */
export interface ReportGroupStat {
  dimension: 'term_type' | 'level' | 'topic' | 'source' | 'pos' | 'card_type';
  key: string;
  n: number;
  passed: number;
}

/** A goal and how far the week got (domain/goals.ts). */
export interface ReportGoalStat {
  key: 'week_active_days' | 'week_minutes' | 'month_new_terms';
  target: number;
  value: number;
}

/**
 * The numbers of one weekly report (v0.3 İP7, domain/weeklyReport.ts). Computed on the device
 * by fixed rules; the AI comment never changes them.
 */
export interface WeeklyReportSummary {
  v: 1;
  /** Monday of the week (local day key). */
  week: string;
  /** Sunday of the week. */
  week_end: string;
  active_days: number;
  /** Answers (reviews, learning steps and new cards). */
  reviews: number;
  minutes: number;
  /** New cards seen for the first time. */
  new_cards: number;
  /** Notes whose first card first reached the review stage this week ("öğrenildi"). */
  new_learned: number;
  /** The week's counted answers (domain/retention.ts rule). */
  retention: { n: number; passed: number };
  /** Window of the categories: the week (7), or 28 days when no category had 20 answers in it. */
  groups_days: 7 | 28;
  strongest: ReportGroupStat | null;
  weakest: ReportGroupStat | null;
  /** The streak at the end of the week. */
  streak: number;
  goals: ReportGoalStat[];
  /** One key of REPORT_FOCUS_KEYS (supabase/functions/_shared/report-contracts.ts). */
  focus: string;
  /** Notes of the focus action (practice list, the words for mnemonics), at most 20. */
  focus_note_ids: Id[];
  /** Number of the focus action (the suggested new-card limit), else null. */
  focus_value: number | null;
}

/**
 * One weekly report. Synced, insert-only, one row per user and week (the server keeps the
 * first one). `comment` is the AI's 3–4 sentences, or null when it could not be had.
 */
export interface WeeklyReport {
  id: Id;
  user_id: string | null;
  week: string;
  summary: WeeklyReportSummary;
  comment: string | null;
  comment_model: string | null;
  prompt_version: string | null;
  device_id: string;
  created_at: Millis;
  hlc: string;
}

/**
 * A report whose comment has not come yet (offline, signed out): local only, not synced. It is
 * shown like a report and becomes a weekly_reports row when the comment arrives or the wait
 * ends (data/weeklyReport.ts).
 */
export interface ReportDraft {
  week: string;
  report: WeeklyReport;
  attempts: number;
  next_attempt_at: Millis;
  last_error: string | null;
}

export type KnownTermSource = 'test' | 'preview' | 'manual' | 'auto';

/** A word the user knows without a card ("Biliyorum"). Deleting it is a tombstone. */
export interface KnownTerm extends SyncedRow {
  /** Normalised dictionary form (normalizeTerm), the same key as notes.term_norm. */
  term_norm: string;
  source: KnownTermSource;
  /** The word's level when it was marked (null: unknown). */
  cefr_at_mark: CefrLevel | null;
}

export interface Source extends SyncedRow {
  /** 'anki': an imported Anki package (v0.3 İP1). */
  kind: 'text' | 'pdf' | 'anki';
  title: string;
  file_name: string | null;
  page_count: number | null;
  /**
   * Topic keys of the text (domain/topics.ts), from the extract call (İP7). Absent or null =
   * unknown (older rows and clients); [] = no topic. Keys this version does not know are kept.
   */
  topics?: string[] | null;
}

/**
 * A smart deck ("Akıllı deste", v0.2 İP8): a named, saved filter over the user's notes.
 * `filter` is the raw JSON of a DeckFilter (domain/deckFilter.ts); it is kept as stored so a
 * filter written by a newer app version survives an edit here.
 */
export interface Deck extends SyncedRow {
  name: string;
  filter: Record<string, unknown>;
  /** Display order, ascending. */
  sort: number;
}

/** "Temalara ayır" result waiting for the user's approval. Local only, never synced. */
export interface ThemePreview {
  id: string; // 'current'
  created_at: Millis;
  model: string | null;
  groups: ThemePreviewGroup[];
  /** Notes sent to the model (for the "N kelimeden M tanesi gruplandı" line). */
  sent: number;
}

export interface ThemePreviewGroup {
  key: string;
  /** Name suggested by the model. */
  suggested: string;
  /** Name the user approves (editable). */
  name: string;
  note_ids: Id[];
  /** Words the user took out of the group. */
  removed: Id[];
  rejected: boolean;
}

export type ThemePref = 'system' | 'light' | 'dark';
export type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
/**
 * Where a word's level comes from (supabase/functions/_shared/level.ts): a word list
 * (CEFR-J, Octanove C1/C2), the AI's guess, word frequency, or the hardest word of a
 * multi-word expression.
 */
export type LevelSource = 'cefrj' | 'octanove' | 'ai' | 'freq' | 'words';

/** Where the user's level comes from: never set, a level test, the weekly update, or by hand. */
export type LevelSourceKind = 'default' | 'test' | 'auto' | 'manual';

/** The last change the weekly update made to the level, with its reason (home "Neden?"). */
export interface LevelChangeNote {
  from: CefrLevel;
  to: CefrLevel;
  /** Week start the decision was made for. */
  week: Millis;
  /** The level whose share decided (the next level when moving up, the own level when down). */
  band: CefrLevel;
  ratio: number;
  ratio_prev: number;
  known: number;
  unknown: number;
  /** The user closed the note on the home screen. */
  dismissed: boolean;
}

/** One settings row per user (id = 'settings'). */
export interface Settings extends SyncedRow {
  daily_new_limit: number; // default 10
  request_retention: number; // 0.80–0.95, default 0.90
  timezone: string; // IANA, e.g. Europe/Istanbul
  day_start_hour: number; // default 4
  theme: ThemePref;
  voice: 'en-US' | 'en-GB';
  level: CefrLevel; // self-estimated, default B1
  /** v0.2 İP3: where `level` comes from; 'default' = never set. */
  level_source: LevelSourceKind;
  /** When `level` last changed (test, weekly update or by hand). */
  level_updated_at: Millis | null;
  /** The weekly update never changes a locked level. */
  level_locked: boolean;
  /** Last change made by the weekly update (null: none). */
  level_change: LevelChangeNote | null;
  fsrs_params: number[] | null; // null = ts-fsrs defaults
  last_backup_at: Millis | null;
  /** Example sentences: Turkish translation always shown (default: hidden until tapped). */
  example_tr_visible?: boolean | null;
  /** Example contexts prepared in the background, in order (null/absent = defaults). */
  example_contexts?: string[] | null;
  /**
   * Topics the user picked (İP7, domain/topics.ts keys). Absent or null = never asked (the
   * home screen offers the choice once); [] = asked, picked none.
   */
  interests?: string[] | null;
  /** Topics the user turned off: they weigh 0 in the profile. */
  muted_topics?: string[] | null;
  /** v0.2 İP4: open "Kolay olabilir" in the import preview (absent/null = closed). */
  show_easy_candidates?: boolean | null;
  /**
   * v0.3 İP4 (docs/decisions/0022): the parameters in use before the last adoption, for "Eski
   * ayara dön" (null = the defaults were in use, or nothing to go back to).
   */
  fsrs_params_prev?: number[] | null;
  /** When the personal-parameter check last ran (adopted or not); absent/null = never. */
  fsrs_opt_at?: Millis | null;
  // v0.3 İP3 load management (docs/decisions/0021-load-management.md). All optional: older
  // rows, backups and servers lack them, and absent means the default.
  /** Most minutes of study a day; turned into cards by domain/capacity.ts (absent/null = 20). */
  daily_capacity_min?: number | null;
  /** Catch-up mode switches itself on when the backlog exceeds capacity (absent/null = on). */
  catchup_auto?: boolean | null;
  /** The current or next vacation, local days, both ends included (null = none). */
  vacation?: VacationRange | null;
  /** Earlier vacations, oldest first (at most 20), so their days stay neutral for the streak. */
  vacation_history?: VacationRange[] | null;
  /**
   * v0.3 İP8: daily reminder (Web Push). `hour` is resolved on the device (auto: the usual
   * start hour, fixed: the chosen one) so the server can use it. Absent/null = off.
   */
  notify?: NotifySetting | null;
  /**
   * v0.3 İP7: goals on the continuity panel (domain/goals.ts). Every field optional; absent
   * or null = no goal of that kind. Never carried to another account.
   */
  goals?: {
    week_active_days?: number | null;
    month_new_terms?: number | null;
    week_minutes?: number | null;
    /** Redesign (home "Hedeflerin"): minutes of study a day (absent/null = no daily goal). */
    day_minutes?: number | null;
    /** Redesign: the level the user aims for ("Hedef B2"); absent/null = the next level. */
    target_level?: CefrLevel | null;
  } | null; /** v0.4 İP3: show the sense's picture on the front of the card too (absent/null = off). */
  show_image_front?: boolean | null;
  /**
   * v0.4 İP8: picture cards ("Görselden hatırlama", decision 0036). Absent/null = on; only a
   * stored false turns them off.
   */
  image_cards?: boolean | null;
  /** v0.4: order of new cards (docs/decisions/0039); absent/null = 'smart'. */
  new_card_order?: NewCardOrder | null;
  /** v0.5 İP1 reading difficulty (domain/texts.ts, decision 0043); absent/null = 'dengeli'. */
  reading_difficulty?: 'rahat' | 'dengeli' | 'zorlayici' | null;
  /** v0.5 İP1: the "çok zor / çok kolay" correction (−0.5..0.5); absent/null = 0. */
  reading_offset?: number | null;
  /** v0.5 İP1: the reader colours words by stage (absent/null = on). */
  reader_highlight?: boolean | null;
  /**
   * v0.5 İP10: days a streak protection covered (YYYY-MM-DD, ascending, at most 48;
   * domain/streakFreeze.ts). Absent/null = none. Never carried to another account.
   */
  streak_freezes?: string[] | null;
}

/** "Yeni kelime sırası": smart (level, frequency, own signals, interference) or as added. */
export type NewCardOrder = 'smart' | 'added';

/** settings.notify (domain/notify.ts). */
export interface NotifySetting {
  enabled: boolean;
  mode: 'auto' | 'fixed';
  hour: number | null;
}

/** Inclusive range of local days (YYYY-MM-DD, day starts at day_start_hour). */
export interface VacationRange {
  start: string;
  end: string;
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
  /** v0.2 level of the sense; absent on rows cached before it (re-pulled by the Dexie v4 upgrade). */
  cefr?: CefrLevel | null;
  cefr_source?: LevelSource | null;
  /** List level before the Turkish-learner correction. */
  cefr_list?: CefrLevel | null;
  /** Short Turkish reason of the correction. */
  cefr_reason_tr?: string | null;
  /** Word frequency of the term (Zipf scale, wordfreq). */
  zipf?: number | null;
}

/** Level band of an example sentence (A1/A2 → A2, …, C1/C2 → C1). */
export type LevelBand = 'A2' | 'B1' | 'B2' | 'C1';

/** Shared example sentence (lexicon_examples), read-only on the client. Never user text. */
export interface LexiconExample {
  id: Id;
  /** lexicon_senses.id (not the user's sense id). */
  sense_id: Id;
  context: string;
  level_band: LevelBand;
  text_en: string;
  /** [start, end) of the term in text_en. */
  span: [number, number];
  /** {"tr": "..."} */
  translations: Record<string, string>;
  status: 'active' | 'retired';
  updated_at: Millis;
}

/**
 * Shared note on a lexicon sense in a language pair (lexicon_pair_notes), read-only on the
 * client (v0.3 İP2): AI mnemonic suggestions and extract-v5 false friends. Never user text.
 * A mnemonic row with content {type: 'none'} records "asked, no good association".
 */
export interface LexiconPairNote {
  id: Id;
  term_norm: string;
  /** lexicon_senses.id (not the user's sense id); null for a note about the whole term. */
  sense_id: Id | null;
  lang_pair: 'en-tr';
  kind: 'false_friend' | 'mnemonic_suggestion' | 'contrast';
  content_key: string;
  content: Record<string, unknown>;
  curated: boolean;
  status: 'active' | 'retired';
  updated_at: Millis;
}

export type FeedbackVerdict = 'like' | 'skip' | 'reject';

/** The user's verdict on a piece of content. One row per target (id derived from the target). */
export interface ContentFeedback extends SyncedRow {
  /** 'example' (lexicon_examples) | 'user_content' | later 'mnemonic', 'false_friend', 'theme'. */
  target_kind: string;
  target_id: Id;
  verdict: FeedbackVerdict;
}

/**
 * Text the user wrote or corrected (an edited example sentence; mnemonics in İP6). Private
 * to the user's account: synced, never written to a shared table.
 */
export interface UserContent extends SyncedRow {
  /** 'example_sentence' | later 'mnemonic', … */
  kind: string;
  lexicon_sense_id: Id | null;
  sense_id: Id | null;
  context: string | null;
  /** The shared item this text corrects (lexicon_examples.id). */
  replaces_id: Id | null;
  text: string;
  translations: Record<string, string> | null;
  span: [number, number] | null;
  selected: boolean | null;
}

/** Background preparation of example sentences for one lexicon sense (device-local queue). */
export interface ExampleJob {
  /** `${sense_id}|${level_band}` */
  key: string;
  sense_id: Id;
  level_band: LevelBand;
  /** Contexts asked for in the last attempt. */
  contexts: string[];
  status: 'queued' | 'done' | 'failed';
  /** Higher runs first (opened on screen > new note > older note). */
  priority: number;
  attempts: number;
  next_attempt_at: Millis;
  created_at: Millis;
  updated_at: Millis;
  error: string | null;
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
  // v0.2 İP4 smart extraction (Dexie v10; local only, set when the job's last chunk is in):
  /** Level of the candidate's sense (lexicon, else the client level file); null = unknown. */
  cefr: CefrLevel | null;
  cefr_source: LevelSource | null;
  /** Preview section (domain/candidates.ts); null until the job is classified. */
  bucket: CandidateBucket | null;
  /** The candidate comes from a vocabulary-list chunk (every entry is shown). */
  from_list: boolean;
}

/**
 * Preview sections of smart extraction: "Senin için", "Kolay olabilir", "Biliyorsun" (a note
 * for the term exists or the word was marked known), and items more than one level above the
 * learner (counted for prose, shown for vocabulary lists).
 */
export type CandidateBucket = 'for_you' | 'easy' | 'known' | 'too_hard';

export interface ChunkCacheRow {
  chunk_hash: string;
  result: unknown; // validated AiExtractResult
  created_at: Millis;
}

export type OutboxTable =
  | 'notes'
  | 'senses'
  | 'cards'
  | 'review_logs'
  | 'sources'
  | 'settings'
  | 'practice_logs'
  | 'content_feedback'
  | 'user_content'
  | 'decks'
  | 'level_tests'
  | 'known_terms'
  | 'weekly_reports'
  // v0.5 İP1 (decision 0043): the server tables are user_texts / user_encounters (sync/api.ts).
  | 'texts'
  | 'encounters';
/** Synced tables whose rows are never changed or deleted. */
export const INSERT_ONLY_TABLES = [
  'review_logs',
  'practice_logs',
  'level_tests',
  'weekly_reports',
] as const satisfies readonly OutboxTable[];
export type InsertOnlyTable = (typeof INSERT_ONLY_TABLES)[number];

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

/** Device cache of a static reference file (the morphology data), keyed by name. */
export interface RefCacheRow {
  key: string;
  /** SHA-256 of the cached file; a new build has a new checksum. */
  sha256: string;
  data: unknown;
  fetched_at: Millis;
}

/** Counts of one Anki import, shown on the result screen (src/data/anki.ts). */
export interface AnkiImportCounts {
  /** Notes in the file. */
  notes: number;
  /** New Engapp notes created with their Anki history. */
  created: number;
  /** Meanings added to a word that was already in the library (no history). */
  sensesAdded: number;
  /** Words (and meanings) the library already had: nothing changed. */
  alreadyHad: number;
  skippedNoteType: number;
  skippedEmpty: number;
  sameInFile: number;
  cards: number;
  cardsMapped: number;
  cardsIgnored: number;
  cardsMerged: number;
  logs: number;
  logsSkipped: number;
  suspended: number;
  media: number;
}

export type AnkiEnrichStatus = 'off' | 'queued' | 'paused' | 'done';

/**
 * One Anki import on this device (v0.3 İP1): its counts and the optional "Sözlükle eşleştir"
 * queue. Local only (the notes themselves sync); id = the import's source id.
 */
export interface AnkiImportRecord {
  id: Id;
  file_name: string;
  created_at: Millis;
  updated_at: Millis;
  counts: AnkiImportCounts;
  /** Notes created by the import (lexicon matching works through them). */
  note_ids: Id[];
  enrich: {
    status: AnkiEnrichStatus;
    /** Notes still to look up, in order. */
    pending: Id[];
    /** Linked to a lexicon sense with the same meaning. */
    matched: number;
    /** Linked to the lexicon word only (no sense with the user's meaning). */
    term_only: number;
    /** Not found in the lexicon (or not an English word). */
    unmatched: number;
    /** Paused until this time (daily AI limit, offline). */
    paused_until: Millis | null;
    error: string | null;
  };
}
