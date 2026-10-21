// zod schemas for synced rows. Used to validate backup files and (later) sync payloads.
import { z } from 'zod';
import type {
  Card,
  ContentFeedback,
  LexiconExample,
  Note,
  PracticeLog,
  ReviewLog,
  Sense,
  Settings,
  Source,
  UserContent,
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

const termType = z.enum(['word', 'phrase', 'pattern']);
const cardState = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
const rating = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);

export const noteSchema: z.ZodType<Note> = z.object({
  ...synced,
  term: z.string().min(1),
  term_norm: z.string().min(1),
  term_type: termType,
  lexicon_term_id: id.nullable(),
  ipa: z.string().nullable(),
  tags: z.array(z.string()),
  possible_duplicate: z.boolean(),
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
  card_type: z.enum(['recognition', 'production', 'cloze']),
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
  kind: z.enum(['text', 'pdf']),
  title: z.string(),
  file_name: z.string().nullable(),
  page_count: z.number().int().nullable(),
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
