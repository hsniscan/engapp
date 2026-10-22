// zod schemas for synced rows. Used to validate backup files and (later) sync payloads.
import { z } from 'zod';
import { clampNotifyHour } from '../../supabase/functions/_shared/push-rule';
import type {
  Card,
  ContentFeedback,
  Deck,
  KnownTerm,
  LevelTest,
  LexiconExample,
  Note,
  PracticeLog,
  ReviewLog,
  Sense,
  Settings,
  Source,
  UserContent,
  WeeklyReport,
} from './types';

const millis = z.number().int();
const id = z.string().min(1);

const synced = {
  id,
  user_id: z.string().nullable(),
  created_at: millis,
  updated_at: millis,
  deleted_at: millis.nullable(),
  hlc: z.string().min(1),
};

const contextKey = z.string().regex(/^[a-z][a-z_]{1,31}$/);
const span = z.tuple([z.number().int(), z.number().int()]);

// Topic key lists (İP7). Free strings, not an enum: a newer device may know more topics.
// Optional, not defaulted: a backup without the key keeps the checksum it was written with.
const topicList = z.array(z.string().min(1).max(40)).max(40).nullable().optional();

const termType = z.enum(['word', 'phrase', 'pattern', 'affix', 'contrast']);
const cefr = z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
const cardState = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
const rating = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
// v0.3 İP3: an inclusive range of local days (domain/vacation.ts).
const vacationRange = z
  .object({ start: dayKey, end: dayKey })
  .refine((r) => r.start <= r.end, 'Vacation ends before it starts');

export const noteSchema: z.ZodType<Note> = z.object({
  ...synced,
  term: z.string().min(1),
  term_norm: z.string().min(1),
  term_type: termType,
  lexicon_term_id: id.nullable(),
  ipa: z.string().nullable(),
  tags: z.array(z.string()),
  possible_duplicate: z.boolean(),
  // v0.2 İP2; absent in older backups and from older servers.
  level_override: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']).nullable().default(null),
});

export const senseSchema: z.ZodType<Sense> = z.object({
  ...synced,
  note_id: id,
  sense_no: z.number().int().min(1),
  lexicon_sense_id: id.nullable(),
  pos: z.string().nullable(),
  gloss_en: z.string().nullable(),
  meaning_tr: z.string(),
  meaning_tr_override: z.string().nullable(),
  source_sentence: z.string().nullable(),
  // Absent in backups and server rows from before the column existed.
  source_sentence_tr: z.string().nullable().default(null),
  span: z.tuple([z.number().int(), z.number().int()]).nullable(),
  source_id: id.nullable(),
});

export const cardSchema: z.ZodType<Card> = z.object({
  ...synced,
  note_id: id,
  sense_id: id.nullable(),
  card_type: z.enum(['recognition', 'production', 'cloze', 'image']),
  suspended: z.boolean(),
  unlocked: z.boolean(),
  due: millis,
  stability: z.number(),
  difficulty: z.number(),
  elapsed_days: z.number(),
  scheduled_days: z.number(),
  learning_steps: z.number().int(),
  reps: z.number().int().min(0),
  lapses: z.number().int().min(0),
  state: cardState,
  last_review: millis.nullable(),
});

export const reviewLogSchema: z.ZodType<ReviewLog> = z.object({
  id,
  user_id: z.string().nullable(),
  card_id: id,
  rating,
  reviewed_at: millis,
  duration_ms: z.number().int().min(0).max(60_000),
  device_id: z.string(),
  undo_of: id.nullable(),
  shown_sense_id: id.nullable(),
  created_at: millis,
  hlc: z.string().min(1),
  // v0.3 İP1: absent/null = 'app'. An unknown value from a newer app is read as absent, so
  // the log still counts.
  origin: z.enum(['app', 'anki']).nullable().optional().catch(undefined),
});

export const practiceLogSchema: z.ZodType<PracticeLog> = z.object({
  id,
  user_id: z.string().nullable(),
  card_id: id,
  practiced_at: millis,
  result: z.enum(['known', 'unknown']),
  mode: z.string().min(1).max(32),
  session_id: id,
  duration_ms: z.number().int().min(0).max(60_000),
  device_id: z.string(),
  created_at: millis,
  hlc: z.string().min(1),
});

export const sourceSchema: z.ZodType<Source> = z.object({
  ...synced,
  kind: z.enum(['text', 'pdf', 'anki']),
  title: z.string(),
  file_name: z.string().nullable(),
  page_count: z.number().int().nullable(),
  topics: topicList,
});

export const settingsSchema: z.ZodType<Settings> = z.object({
  ...synced,
  daily_new_limit: z.number().int().min(0).max(9999),
  request_retention: z.number().min(0.7).max(0.99),
  timezone: z.string().min(1),
  day_start_hour: z.number().int().min(0).max(23),
  theme: z.enum(['system', 'light', 'dark']),
  voice: z.enum(['en-US', 'en-GB']),
  level: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']),
  fsrs_params: z.array(z.number()).nullable(),
  last_backup_at: millis.nullable(),
  // v0.2 İP5. Optional and without a default (older backups and server rows lack them;
  // a default would change the backup checksum of rows that never had the key).
  example_tr_visible: z.boolean().nullish(),
  example_contexts: z.array(contextKey).max(12).nullish(),
  interests: topicList,
  muted_topics: topicList,
  // v0.2 İP3; absent in older backups and from older servers.
  level_source: z.enum(['default', 'test', 'auto', 'manual']).default('default'),
  level_updated_at: millis.nullable().default(null),
  level_locked: z.boolean().default(false),
  level_change: z
    .object({
      from: cefr,
      to: cefr,
      week: millis,
      band: cefr,
      ratio: z.number(),
      ratio_prev: z.number(),
      known: z.number(),
      unknown: z.number(),
      dismissed: z.boolean().default(false),
    })
    .nullable()
    .default(null)
    // A malformed note (newer client, hand-edited backup) must not reject the whole row.
    .catch(null),
  // v0.2 İP4; absent in older rows and backups (= false).
  show_easy_candidates: z.boolean().nullish(),
  // v0.4 İP3 (absent = off).
  show_image_front: z.boolean().nullish(),
  // v0.4 İP8 picture cards (absent/null = on). A malformed value reads as unset.
  image_cards: z.boolean().nullish().catch(null),
  // v0.3 İP3 load management; absent in older rows and backups (= the defaults). Malformed
  // values (a newer client, a hand-edited backup) fall back to "unset" instead of rejecting
  // the whole settings row.
  daily_capacity_min: z.number().int().min(1).max(600).nullish().catch(null),
  catchup_auto: z.boolean().nullish().catch(null),
  vacation: vacationRange.nullish().catch(null),
  vacation_history: z.array(vacationRange).max(50).nullish().catch(null),
  // v0.3 İP4; absent in older rows and backups (= nothing to revert, never ran).
  fsrs_params_prev: z.array(z.number()).nullish(),
  fsrs_opt_at: millis.nullish(),
  // v0.3 İP8; absent in older rows and backups (= off). A malformed value must not reject the row.
  // The hour is kept inside 09–21 like the patch schema (data/settings.ts) and the push rule
  // (clampNotifyHour): a reminder at 22:00 would fall into the quiet hours (decision 0024).
  notify: z
    .object({
      enabled: z.boolean(),
      mode: z.enum(['auto', 'fixed']).catch('auto'),
      hour: z
        .number()
        .int()
        .nullable()
        .transform((h) => (h === null ? null : clampNotifyHour(h)))
        .catch(null),
    })
    .nullish()
    .catch(null),
  // v0.3 İP7; absent in older rows and backups (= no goals). A malformed goal (a newer
  // client, a hand-edited backup) is dropped, not the row.
  goals: z
    .object({
      week_active_days: z.number().int().min(1).max(7).nullish().catch(null),
      month_new_terms: z.number().int().min(1).max(100_000).nullish().catch(null),
      week_minutes: z.number().int().min(1).max(100_000).nullish().catch(null),
    })
    .nullish()
    .catch(null),
});

export const contentFeedbackSchema: z.ZodType<ContentFeedback> = z.object({
  ...synced,
  target_kind: contextKey,
  target_id: id,
  verdict: z.enum(['like', 'skip', 'reject']),
});

export const userContentSchema: z.ZodType<UserContent> = z.object({
  ...synced,
  kind: contextKey,
  lexicon_sense_id: id.nullable(),
  sense_id: id.nullable(),
  context: contextKey.nullable(),
  replaces_id: id.nullable(),
  text: z.string().min(1).max(1000),
  translations: z.record(z.string(), z.string()).nullable(),
  span: span.nullable(),
  selected: z.boolean().nullable(),
});

export const lexiconExampleSchema: z.ZodType<LexiconExample> = z.object({
  id,
  sense_id: id,
  context: contextKey,
  level_band: z.enum(['A2', 'B1', 'B2', 'C1']),
  text_en: z.string().min(1).max(300),
  span,
  translations: z.record(z.string(), z.string()),
  status: z.enum(['active', 'retired']),
  updated_at: millis,
});

/** decks.filter is kept as raw JSON here; domain/deckFilter.ts parses it for evaluation. */
export const deckSchema: z.ZodType<Deck> = z.object({
  ...synced,
  name: z.string().min(1).max(200),
  filter: z.record(z.string(), z.unknown()),
  sort: z.number().int(),
});

export const levelTestItemSchema = z.object({
  w: z.string().min(1).max(64),
  band: cefr.nullable(),
  pseudo: z.boolean(),
  answer: z.enum(['yes', 'no']),
  mc_ok: z.boolean().optional(),
});

export const levelTestSchema: z.ZodType<LevelTest> = z.object({
  id,
  user_id: z.string().nullable(),
  taken_at: millis,
  result_level: cefr,
  vocab_estimate: z.number().int().min(0),
  reliable: z.boolean(),
  false_alarm_rate: z.number().min(0).max(1),
  ratios: z.object({ A1: z.number(), A2: z.number(), B1: z.number(), B2: z.number(), C1: z.number(), C2: z.number() }),
  items: z.array(levelTestItemSchema).max(200),
  bank_version: z.string().min(1).max(64),
  applied: z.boolean(),
  duration_ms: z.number().int().min(0),
  device_id: z.string(),
  created_at: millis,
  hlc: z.string().min(1),
});

export const knownTermSchema: z.ZodType<KnownTerm> = z.object({
  ...synced,
  term_norm: z.string().min(1).max(200),
  source: z.enum(['test', 'preview', 'manual', 'auto']),
  cefr_at_mark: cefr.nullable().default(null),
});

const reportGroupStat = z.object({
  dimension: z.enum(['term_type', 'level', 'topic', 'source', 'pos', 'card_type']),
  key: z.string().min(1).max(200),
  n: z.number().int().min(0),
  passed: z.number().int().min(0),
});

/**
 * The numbers of a weekly report (v0.3 İP7). Loose: a newer app version may add fields, and
 * they are kept, so an insert-only row is never changed by reading it.
 */
export const weeklyReportSummarySchema = z.looseObject({
  v: z.literal(1),
  week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  week_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  active_days: z.number().int().min(0).max(7),
  reviews: z.number().int().min(0),
  minutes: z.number().int().min(0),
  new_cards: z.number().int().min(0),
  new_learned: z.number().int().min(0),
  retention: z.object({ n: z.number().int().min(0), passed: z.number().int().min(0) }),
  groups_days: z.union([z.literal(7), z.literal(28)]),
  strongest: reportGroupStat.nullable(),
  weakest: reportGroupStat.nullable(),
  streak: z.number().int().min(0),
  goals: z
    .array(
      z.object({
        key: z.enum(['week_active_days', 'week_minutes', 'month_new_terms']),
        target: z.number().int().min(0),
        value: z.number().int().min(0),
      }),
    )
    .max(3),
  focus: z.string().min(1).max(40),
  focus_note_ids: z.array(id).max(20),
  focus_value: z.number().int().nullable(),
});

/** A weekly report row (insert-only, one per user and week). */
export const weeklyReportSchema: z.ZodType<WeeklyReport> = z.object({
  id,
  user_id: z.string().nullable(),
  week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  summary: weeklyReportSummarySchema,
  comment: z.string().min(1).max(2000).nullable(),
  comment_model: z.string().max(100).nullable(),
  prompt_version: z.string().max(40).nullable(),
  device_id: z.string(),
  created_at: millis,
  hlc: z.string().min(1),
});
