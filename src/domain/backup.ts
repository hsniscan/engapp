// JSON backup file (all synced tables + settings) and CSV export of notes.
import { z } from 'zod';
import { sha256Hex } from './chunking';
import { type DayConfig, dayKeyOf } from './day';
import { effectiveLogs } from './recompute';
import {
  cardSchema,
  contentFeedbackSchema,
  deckSchema,
  knownTermSchema,
  levelTestSchema,
  noteSchema,
  practiceLogSchema,
  reviewLogSchema,
  senseSchema,
  settingsSchema,
  sourceSchema,
  userContentSchema,
} from './schemas';
import type {
  Card,
  ContentFeedback,
  Deck,
  KnownTerm,
  LevelTest,
  Millis,
  Note,
  PracticeLog,
  ReviewLog,
  Sense,
  Settings,
  Source,
  UserContent,
} from './types';

export const BACKUP_FORMAT = 'engapp-backup';
// 2: senses.source_sentence_tr. Version 1 files (without it) are still accepted.
// 3: practice_logs. Older files have no such table (restored as none).
// 4: notes.level_override. Older files have none (restored as null: the computed level).
// 5 (v0.2 İP5): content_feedback and user_content (likes/rejections of example sentences,
//    the user's own edits). Older files have neither (restored as none).
// 6 (v0.2 İP7): settings.interests, settings.muted_topics, sources.topics (optional and not
//    defaulted, so older files restore and keep their checksum).
// 7 (v0.2 İP8): decks. Older files have none (restore keeps the local decks).
//    (İP7 and İP8 were built as "4" on their branches; no such file was ever released.)
// 8 (v0.2 İP3, İP4): level_tests, known_terms and the level fields of settings; also the
//    optional settings.show_easy_candidates. Older files have no such tables (restored as
//    none; overwrite keeps the local ones) and default level fields. (Built as "9" on its branch, numbered like its Dexie version; never released.)
export const BACKUP_SCHEMA_VERSION = 8;

export interface BackupTables {
  notes: Note[];
  senses: Sense[];
  cards: Card[];
  review_logs: ReviewLog[];
  sources: Source[];
  settings: Settings[];
  /** Absent in files before schema_version 3; buildBackup always writes it. */
  practice_logs?: PracticeLog[];
  /** Absent in files before schema_version 5; buildBackup always writes them. */
  content_feedback?: ContentFeedback[];
  user_content?: UserContent[];
  /** Absent in files before schema_version 7; buildBackup always writes it. */
  decks?: Deck[];
  /** Absent in files before schema_version 8; buildBackup always writes them. */
  level_tests?: LevelTest[];
  known_terms?: KnownTerm[];
}

export const backupTablesSchema = z.object({
  notes: z.array(noteSchema),
  senses: z.array(senseSchema),
  cards: z.array(cardSchema),
  review_logs: z.array(reviewLogSchema),
  sources: z.array(sourceSchema),
  settings: z.array(settingsSchema).max(1),
  // Optional, not defaulted: a file without the key must keep the checksum it was written with.
  practice_logs: z.array(practiceLogSchema).optional(),
  content_feedback: z.array(contentFeedbackSchema).optional(),
  user_content: z.array(userContentSchema).optional(),
  decks: z.array(deckSchema).optional(),
  level_tests: z.array(levelTestSchema).optional(),
  known_terms: z.array(knownTermSchema).optional(),
});

export const backupSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  schema_version: z.number().int().min(1),
  exported_at: z.number().int(),
  device_id: z.string().nullable(),
  tables: backupTablesSchema,
  /** SHA-256 hex of canonicalJson(tables). */
  checksum: z.string().regex(/^[0-9a-f]{64}$/),
});

export type BackupFile = z.infer<typeof backupSchema>;

/** JSON with object keys sorted recursively; identical data → identical string. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

const byId = <T extends { id: string }>(rows: T[]): T[] =>
  [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

export function sortTables(t: BackupTables): BackupTables {
  return {
    notes: byId(t.notes),
    senses: byId(t.senses),
    cards: byId(t.cards),
    review_logs: byId(t.review_logs),
    sources: byId(t.sources),
    settings: byId(t.settings),
    ...(t.practice_logs ? { practice_logs: byId(t.practice_logs) } : {}),
    ...(t.content_feedback ? { content_feedback: byId(t.content_feedback) } : {}),
    ...(t.user_content ? { user_content: byId(t.user_content) } : {}),
    ...(t.decks ? { decks: byId(t.decks) } : {}),
    ...(t.level_tests ? { level_tests: byId(t.level_tests) } : {}),
    ...(t.known_terms ? { known_terms: byId(t.known_terms) } : {}),
  };
}

export function backupChecksum(tables: BackupTables): Promise<string> {
  return sha256Hex(canonicalJson(sortTables(tables)));
}

export async function buildBackup(
  tables: BackupTables,
  meta: { exported_at: Millis; device_id: string | null },
): Promise<BackupFile> {
  const sorted = sortTables({
    ...tables,
    practice_logs: tables.practice_logs ?? [],
    content_feedback: tables.content_feedback ?? [],
    user_content: tables.user_content ?? [],
    decks: tables.decks ?? [],
    level_tests: tables.level_tests ?? [],
    known_terms: tables.known_terms ?? [],
  });
  return {
    format: BACKUP_FORMAT,
    schema_version: BACKUP_SCHEMA_VERSION,
    exported_at: meta.exported_at,
    device_id: meta.device_id,
    tables: sorted,
    checksum: await backupChecksum(sorted),
  };
}

export interface BackupSummary {
  notes: number;
  senses: number;
  cards: number;
  reviews: number;
  sources: number;
}

/** Counts shown before restore ("x not, y kart, z tekrar"): live rows, non-undone answers. */
export function summarizeBackup(tables: BackupTables): BackupSummary {
  const live = (rows: { deleted_at: Millis | null }[]): number => rows.filter((r) => r.deleted_at === null).length;
  return {
    notes: live(tables.notes),
    senses: live(tables.senses),
    cards: live(tables.cards),
    reviews: effectiveLogs(tables.review_logs).length,
    sources: live(tables.sources),
  };
}

export type BackupError = 'invalid_json' | 'invalid_format' | 'unsupported_version' | 'checksum_mismatch';

export type VerifyResult =
  | { ok: true; backup: BackupFile; summary: BackupSummary }
  | { ok: false; error: BackupError; detail?: string };

/** Parse (if a string), validate with zod and check the checksum. */
export async function verifyBackup(input: unknown): Promise<VerifyResult> {
  let data = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch (e) {
      return { ok: false, error: 'invalid_json', detail: String(e) };
    }
  }
  const version = (data as { schema_version?: unknown } | null)?.schema_version;
  if (typeof version === 'number' && version > BACKUP_SCHEMA_VERSION) {
    return { ok: false, error: 'unsupported_version', detail: `schema_version ${version}` };
  }
  const parsed = backupSchema.safeParse(data);
  if (!parsed.success) return { ok: false, error: 'invalid_format', detail: z.prettifyError(parsed.error) };
  if (!(await checksumMatches(parsed.data.tables, parsed.data.checksum))) {
    return { ok: false, error: 'checksum_mismatch' };
  }
  return { ok: true, backup: parsed.data, summary: summarizeBackup(parsed.data.tables) };
}

/**
 * Parsing fills in fields that older files did not have (the level fields of settings before
 * version 9, `notes.level_override` before version 4, `senses.source_sentence_tr` before
 * version 2) with their defaults; the file's checksum did not cover them. Tries the tables
 * as they are, then as such older files had them.
 */
async function checksumMatches(t: BackupTables, checksum: string): Promise<boolean> {
  const v3 = { ...t, notes: t.notes.map((n) => withoutNull(n, 'level_override')) };
  const v1 = { ...v3, senses: t.senses.map((s) => withoutNull(s, 'source_sentence_tr')) };
  for (const tables of [t, v3, v1]) {
    if ((await backupChecksum(tables)) === checksum) return true;
    const pre9 = { ...tables, settings: tables.settings.map(withoutLevelDefaults) };
    if ((await backupChecksum(pre9)) === checksum) return true;
  }
  return false;
}

/** Settings as a file before version 9 had them (the level fields at their defaults). */
function withoutLevelDefaults(row: Settings): Settings {
  const copy: Partial<Settings> = { ...row };
  if (copy.level_source === 'default') delete copy.level_source;
  if (copy.level_updated_at === null) delete copy.level_updated_at;
  if (copy.level_locked === false) delete copy.level_locked;
  if (copy.level_change === null) delete copy.level_change;
  return copy as Settings;
}

function withoutNull<T extends object>(row: T, key: keyof T): T {
  if (row[key] !== null) return row;
  const copy = { ...row };
  delete copy[key];
  return copy;
}

// ---------------------------------------------------------------- CSV

export interface CsvHeaders {
  term: string;
  meaning: string;
  ipa: string;
  sentence: string;
  tags: string;
  created: string;
}

export const DEFAULT_CSV_HEADERS: CsvHeaders = {
  term: 'term',
  meaning: 'meaning',
  ipa: 'ipa',
  sentence: 'sentence',
  tags: 'tags',
  created: 'created',
};

export const CSV_SEPARATOR = ';';

/** Quote when needed; neutralize spreadsheet formulas (=, +, -, @ at the start). */
export function csvCell(value: string): string {
  let v = value;
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  if (/[";\r\n]/.test(v) || v !== v.trim()) v = `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function senseMeaning(s: Pick<Sense, 'meaning_tr' | 'meaning_tr_override'>): string {
  return s.meaning_tr_override?.trim() || s.meaning_tr;
}

/**
 * Notes as an Excel-friendly CSV: UTF-8 BOM, ";" separator, CRLF. One row per live note;
 * several senses are numbered ("1. banka | 2. kıyı").
 */
export function buildNotesCsv(
  notes: Note[],
  senses: Sense[],
  opts: { timezone: string; headers?: CsvHeaders },
): string {
  const h = opts.headers ?? DEFAULT_CSV_HEADERS;
  const cfg: DayConfig = { timezone: opts.timezone, day_start_hour: 0 };
  const sensesByNote = new Map<string, Sense[]>();
  for (const s of senses) {
    if (s.deleted_at !== null) continue;
    const list = sensesByNote.get(s.note_id) ?? [];
    list.push(s);
    sensesByNote.set(s.note_id, list);
  }
  const rows: string[][] = [[h.term, h.meaning, h.ipa, h.sentence, h.tags, h.created]];
  const live = notes.filter((n) => n.deleted_at === null).sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : 1));
  for (const n of live) {
    const list = (sensesByNote.get(n.id) ?? []).sort((a, b) => a.sense_no - b.sense_no);
    const meanings =
      list.length === 1 ? senseMeaning(list[0]!) : list.map((s, i) => `${i + 1}. ${senseMeaning(s)}`).join(' | ');
    const sentences = list.map((s) => s.source_sentence?.trim()).filter((s): s is string => !!s);
    rows.push([n.term, meanings, n.ipa ?? '', sentences.join(' | '), n.tags.join(', '), dayKeyOf(n.created_at, cfg)]);
  }
  return '﻿' + rows.map((r) => r.map(csvCell).join(CSV_SEPARATOR)).join('\r\n') + '\r\n';
}
