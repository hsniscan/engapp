// JSON backup file (all synced tables + settings) and CSV export of notes.
import { z } from 'zod';
import { sha256Hex } from './chunking';
import { type DayConfig, dayKeyOf } from './day';
import { effectiveLogs } from './recompute';
import { cardSchema, noteSchema, reviewLogSchema, senseSchema, settingsSchema, sourceSchema } from './schemas';
import type { Card, Millis, Note, ReviewLog, Sense, Settings, Source } from './types';

export const BACKUP_FORMAT = 'engapp-backup';
export const BACKUP_SCHEMA_VERSION = 1;

export interface BackupTables {
  notes: Note[];
  senses: Sense[];
  cards: Card[];
  review_logs: ReviewLog[];
  sources: Source[];
  settings: Settings[];
}

export const backupTablesSchema = z.object({
  notes: z.array(noteSchema),
  senses: z.array(senseSchema),
  cards: z.array(cardSchema),
  review_logs: z.array(reviewLogSchema),
  sources: z.array(sourceSchema),
  settings: z.array(settingsSchema).max(1),
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
  };
}

export function backupChecksum(tables: BackupTables): Promise<string> {
  return sha256Hex(canonicalJson(sortTables(tables)));
}

export async function buildBackup(
  tables: BackupTables,
  meta: { exported_at: Millis; device_id: string | null },
): Promise<BackupFile> {
  const sorted = sortTables(tables);
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
  const checksum = await backupChecksum(parsed.data.tables);
  if (checksum !== parsed.data.checksum) return { ok: false, error: 'checksum_mismatch' };
  return { ok: true, backup: parsed.data, summary: summarizeBackup(parsed.data.tables) };
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
