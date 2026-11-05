// Sync transport: thin typed wrappers around the Postgres RPC functions
// (supabase/migrations/20261021000400_sync.sql). The sync engine (outbox, cursors,
// conflict handling, recompute) builds on these; see docs/sync-strategy.md.

import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { lexiconEntry } from '../../supabase/functions/_shared/contracts';
import {
  cardSchema,
  contentFeedbackSchema,
  lexiconExampleSchema,
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
  weeklyReportSchema,
  readerTextSchema,
  encounterRowSchema,
} from '@/domain/schemas';
import type { EncounterRow, ReaderText } from '@/domain/texts';
import type {
  Card,
  ContentFeedback,
  LexiconExample,
  Deck,
  KnownTerm,
  LevelTest,
  WeeklyReport,
  LexiconSense,
  Note,
  OutboxTable,
  PracticeLog,
  ReviewLog,
  Sense,
  Settings,
  Source,
  UserContent,
} from '@/domain/types';
import { loadSupabase } from '@/lib/supabase';

export const MAX_PUSH_BATCH = 100;
export const MAX_PULL_PAGE = 500;
/**
 * Byte budget of one pull page (sync_pull_v4, decision 0060): about 1 MB of JSON, so a page
 * of long reading texts parses quickly on a phone and never times out on the server.
 */
export const MAX_PULL_BYTES = 1_048_576;

/**
 * Local copies of text bodies by id (the reader's `texts` table). sync_pull_v4 leaves out the
 * body of a text the device already has; the transport fills it from here, or from the server
 * when the device has none.
 */
export type LocalTextBodies = (ids: string[]) => Promise<Map<string, string>>;

export interface PushItem {
  table: OutboxTable;
  op: 'upsert' | 'delete';
  /** The full row (user_id is ignored: the server uses the session's user). For a delete,
   *  either the full row with deleted_at set or at least {id, hlc, deleted_at}. */
  payload: unknown;
}

const pushResult = z.object({
  acked: z.array(z.string()),
  stale: z.array(z.string()),
  rejected: z.array(
    z.object({
      table: z.string().nullable(),
      id: z.string().nullable(),
      code: z.string(),
      message: z.string(),
    }),
  ),
});
export type PushResult = z.infer<typeof pushResult>;

export interface RowByTable {
  notes: Note;
  senses: Sense;
  cards: Card;
  review_logs: ReviewLog;
  sources: Source;
  settings: Settings;
  practice_logs: PracticeLog;
  content_feedback: ContentFeedback;
  user_content: UserContent;
  decks: Deck;
  level_tests: LevelTest;
  known_terms: KnownTerm;
  weekly_reports: WeeklyReport;
  texts: ReaderText;
  encounters: EncounterRow;
}
export type PulledRow = {
  [T in OutboxTable]: { table: T; seq: number; row: RowByTable[T] };
}[OutboxTable];

const ROW_SCHEMAS: { [T in OutboxTable]: z.ZodType<RowByTable[T]> } = {
  notes: noteSchema,
  senses: senseSchema,
  cards: cardSchema,
  review_logs: reviewLogSchema,
  sources: sourceSchema,
  settings: settingsSchema,
  practice_logs: practiceLogSchema,
  content_feedback: contentFeedbackSchema,
  user_content: userContentSchema,
  decks: deckSchema,
  level_tests: levelTestSchema,
  known_terms: knownTermSchema,
  weekly_reports: weeklyReportSchema,
  texts: readerTextSchema,
  encounters: encounterRowSchema,
};

/**
 * Local tables whose server table has another name (v0.5 İP1, decision 0043): "texts" and
 * "encounters" are generic words, so the server says whose they are. The names are mapped
 * here, at the wire, and nowhere else: the outbox, Dexie and the engine use the local name.
 */
const SERVER_NAME: Partial<Record<OutboxTable, string>> = {
  texts: 'user_texts',
  encounters: 'user_encounters',
};
const LOCAL_NAME: Record<string, OutboxTable> = Object.fromEntries(
  Object.entries(SERVER_NAME).map(([local, server]) => [server, local as OutboxTable]),
);
/** The server's name of a local synced table. */
export const serverTableName = (t: OutboxTable): string => SERVER_NAME[t] ?? t;
/** The local name of a server table (unknown names pass through unchanged). */
export const localTableName = (t: string): string => LOCAL_NAME[t] ?? t;

const pullEnvelope = z.object({
  rows: z.array(
    z.object({ table: z.string(), seq: z.number(), row: z.record(z.string(), z.unknown()) }),
  ),
  next_seq: z.number(),
  has_more: z.boolean(),
  full_resync: z.boolean(),
  // sync_pull_v5 (decision 0075): the server's restore epoch and the head of its sequence.
  epoch: z.number().optional().catch(undefined),
  seq_head: z.number().nullable().optional().catch(undefined),
});

export interface PullResult {
  rows: PulledRow[];
  /** Rows the client could not validate (logged; the cursor still moves past them). */
  invalid: { table: string; seq: number; id: unknown; error: string }[];
  next_seq: number;
  has_more: boolean;
  full_resync: boolean;
  /**
   * The pull function that answered: 3 = sync_pull_v3 or v4 (the server stores
   * practice_logs), 2 = sync_pull_v2, 1 = sync_pull. Older backends are used until the
   * migrations land.
   */
  version: 1 | 2 | 3;
  /**
   * The server's restore epoch (sync_pull_v5, decision 0075): it changes when the database is
   * restored from a backup. Undefined from an older backend.
   */
  epoch?: number;
  /** The last value of the server's sync sequence (v5); a cursor above it means a restore. */
  seqHead?: number | null;
}

const lexiconPullEnvelope = z.object({
  rows: z.array(lexiconEntry),
  next_seq: z.number(),
  has_more: z.boolean(),
});
export interface LexiconPullResult {
  rows: LexiconSense[];
  next_seq: number;
  has_more: boolean;
}

export type SyncApiErrorKind =
  'not_configured' | 'not_signed_in' | 'network' | 'server' | 'invalid_response';

export class SyncApiError extends Error {
  readonly kind: SyncApiErrorKind;
  constructor(kind: SyncApiErrorKind, message: string) {
    super(message);
    this.name = 'SyncApiError';
    this.kind = kind;
  }
}

async function client(c?: SupabaseClient | null): Promise<SupabaseClient> {
  const s = c === undefined ? await loadSupabase() : c;
  if (!s) throw new SyncApiError('not_configured', 'Supabase is not configured (guest mode)');
  return s;
}

async function rpc<T>(
  c: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
  schema: z.ZodType<T>,
): Promise<T> {
  let res: { data: unknown; error: { code?: string; message: string } | null };
  try {
    res = await c.rpc(fn, args);
  } catch (e) {
    throw new SyncApiError('network', e instanceof Error ? e.message : String(e));
  }
  if (res.error) {
    const { code, message } = res.error;
    if (
      code === '42501' ||
      code === 'PGRST301' ||
      code === 'PGRST303' ||
      /jwt|unauthorized/i.test(message)
    ) {
      throw new SyncApiError('not_signed_in', message);
    }
    if (!code && /fetch|network|load failed/i.test(message))
      throw new SyncApiError('network', message);
    throw new SyncApiError('server', `${code ?? ''} ${message}`.trim());
  }
  const parsed = schema.safeParse(res.data);
  if (!parsed.success) throw new SyncApiError('invalid_response', parsed.error.message);
  return parsed.data;
}

/** Sends up to 100 outbox rows. Delete the outbox rows whose row_id is in `acked`. */
export async function pushBatch(items: PushItem[], c?: SupabaseClient | null): Promise<PushResult> {
  if (items.length > MAX_PUSH_BATCH)
    throw new RangeError(`at most ${MAX_PUSH_BATCH} rows per push`);
  if (items.length === 0) return { acked: [], stale: [], rejected: [] };
  const wire = items.map((i) => ({ ...i, table: serverTableName(i.table) }));
  const res = await rpc(await client(c), 'sync_push', { p_batch: wire }, pushResult);
  return {
    ...res,
    rejected: res.rejected.map((r) => ({ ...r, table: r.table === null ? null : localTableName(r.table) })),
  };
}

/** sync_pull_v2 is not deployed yet (older backend): PostgREST / Postgres "no such function". */
function isMissingFunction(e: unknown): boolean {
  return e instanceof SyncApiError && e.kind === 'server' && /^(PGRST202|42883)\b/.test(e.message);
}

/**
 * Changes after `sinceSeq`, ordered by server sequence. Store next_seq with the rows.
 * `fromSeq` is the cursor this run of pages started at (0 for a full pull): the server
 * decides `full_resync` from it, so the pages of a full pull are never cut short by an
 * old tombstone purge. With it the newest pull function is tried first and an older one
 * answers when the backend does not have it yet: sync_pull_v3 (all registered tables,
 * practice_logs included; migration 20261021000900) → sync_pull_v2 (the six v0.1 tables;
 * 20261021000600) → sync_pull. Without `fromSeq` the old sync_pull is used.
 */
export async function pullChanges(
  sinceSeq: number,
  limit = MAX_PULL_PAGE,
  c?: SupabaseClient | null,
  fromSeq?: number,
  localBodies?: LocalTextBodies,
): Promise<PullResult> {
  const cl = await client(c);
  const p_limit = Math.min(limit, MAX_PULL_PAGE);
  let env: z.infer<typeof pullEnvelope> | null = null;
  let version: PullResult['version'] = 1;
  if (fromSeq !== undefined) {
    // sync_pull_v4 (decision 0060): pages bounded by bytes too, unchanged text bodies left out.
    // sync_pull_v5 (decision 0075): v4 plus the restore epoch.
    const tries = [
      ['sync_pull_v5', 3, { p_max_bytes: MAX_PULL_BYTES }],
      ['sync_pull_v4', 3, { p_max_bytes: MAX_PULL_BYTES }],
      ['sync_pull_v3', 3, {}],
      ['sync_pull_v2', 2, {}],
    ] as const;
    for (const [fn, v, extra] of tries) {
      try {
        env = await rpc(cl, fn, { p_since: sinceSeq, p_limit, p_from: fromSeq, ...extra }, pullEnvelope);
        version = v;
        break;
      } catch (e) {
        if (!isMissingFunction(e)) throw e;
      }
    }
  }
  env ??= await rpc(cl, 'sync_pull', { p_since: sinceSeq, p_limit }, pullEnvelope);
  await fillTextBodies(cl, env.rows, localBodies);
  const rows: PulledRow[] = [];
  const invalid: PullResult['invalid'] = [];
  for (const r of env.rows) {
    const table = localTableName(r.table);
    const schema = ROW_SCHEMAS[table as OutboxTable];
    if (!schema) {
      invalid.push({ table, seq: r.seq, id: r.row.id, error: 'unknown table' });
      continue;
    }
    const p = schema.safeParse(r.row);
    if (p.success) rows.push({ table, seq: r.seq, row: p.data } as PulledRow);
    else invalid.push({ table, seq: r.seq, id: r.row.id, error: p.error.message });
  }
  return {
    rows,
    invalid,
    next_seq: env.next_seq,
    has_more: env.has_more,
    full_resync: env.full_resync,
    version,
    ...(env.epoch !== undefined ? { epoch: env.epoch } : {}),
    ...(env.seq_head !== undefined ? { seqHead: env.seq_head } : {}),
  };
}

const encoder = new TextEncoder();

/**
 * user_texts rows that came without `body` (the server's copy did not change since this
 * device's cursor) get the device's own copy when its UTF-8 length matches `body_bytes`, or
 * else the server's body, fetched by id. A row whose body cannot be found stays without one
 * and fails validation (logged as invalid, the cursor moves on, as for any invalid row).
 */
export async function fillTextBodies(
  cl: SupabaseClient,
  rows: { table: string; row: Record<string, unknown> }[],
  localBodies?: LocalTextBodies,
): Promise<void> {
  const slim = rows.filter((r) => r.table === 'user_texts' && typeof r.row.body !== 'string');
  if (slim.length === 0) return;
  const ids = slim.map((r) => String(r.row.id));
  const local = localBodies ? await localBodies(ids) : new Map<string, string>();
  const missing: string[] = [];
  for (const r of slim) {
    const body = local.get(String(r.row.id));
    // A library text has no body on the server (decision 0075): keep the device's own copy.
    const graded = r.row.kind === 'graded' && typeof r.row.graded_id === 'string' && Number(r.row.body_bytes) === 0;
    if (graded) {
      r.row.body = body ?? '';
    } else if (body !== undefined && encoder.encode(body).length === Number(r.row.body_bytes)) {
      r.row.body = body;
    } else {
      missing.push(String(r.row.id));
    }
    delete r.row.body_bytes;
  }
  if (missing.length === 0) return;
  const fetched = new Map<string, string>();
  for (let i = 0; i < missing.length; i += 50) {
    let res: { data: unknown; error: { message: string } | null };
    try {
      res = await cl.from('user_texts').select('id, body').in('id', missing.slice(i, i + 50));
    } catch (e) {
      throw new SyncApiError('network', e instanceof Error ? e.message : String(e));
    }
    if (res.error) throw new SyncApiError('server', res.error.message);
    const parsed = z.array(z.object({ id: z.string(), body: z.string() })).safeParse(res.data);
    if (!parsed.success) throw new SyncApiError('invalid_response', parsed.error.message);
    for (const x of parsed.data) fetched.set(x.id, x.body);
  }
  for (const r of slim) {
    const body = fetched.get(String(r.row.id));
    if (body !== undefined) r.row.body = body;
  }
}

/**
 * Names in the server's sync registry (public.sync_tables, readable by signed-in users), or
 * null when the backend predates the registry. The engine holds back rows of tables the
 * server does not list yet (LATE_SYNC_TABLES), so a client released before its migration
 * never burns their push attempts.
 */
export async function listSyncTables(c?: SupabaseClient | null): Promise<string[] | null> {
  const cl = await client(c);
  let res: { data: unknown; error: { code?: string; message: string } | null };
  try {
    res = await cl.from('sync_tables').select('name');
  } catch (e) {
    throw new SyncApiError('network', e instanceof Error ? e.message : String(e));
  }
  if (res.error) {
    // No such relation (PostgREST PGRST205 / Postgres 42P01): an older backend.
    if (/^(PGRST205|42P01)$/.test(res.error.code ?? '')) return null;
    if (!res.error.code && /fetch|network|load failed/i.test(res.error.message)) throw new SyncApiError('network', res.error.message);
    throw new SyncApiError('server', `${res.error.code ?? ''} ${res.error.message}`.trim());
  }
  const parsed = z.array(z.object({ name: z.string() })).safeParse(res.data);
  if (!parsed.success) throw new SyncApiError('invalid_response', parsed.error.message);
  return parsed.data.map((r) => localTableName(r.name));
}

/** Lexicon senses referenced by the user's senses, changed after `sinceSeq` (lexicon_cursor). */
export async function pullLexicon(
  sinceSeq: number,
  limit = MAX_PULL_PAGE,
  c?: SupabaseClient | null,
): Promise<LexiconPullResult> {
  return rpc(
    await client(c),
    'lexicon_pull',
    { p_since: sinceSeq, p_limit: Math.min(limit, MAX_PULL_PAGE) },
    lexiconPullEnvelope,
  );
}

/** Lexicon senses by id (≤ 500): fills lexicon_cache gaps for senses synced from another device. */
export async function getLexiconSenses(
  ids: string[],
  c?: SupabaseClient | null,
): Promise<LexiconSense[]> {
  if (ids.length === 0) return [];
  if (ids.length > 500) throw new RangeError('at most 500 ids');
  return rpc(await client(c), 'lexicon_get', { p_ids: ids }, z.array(lexiconEntry));
}

const examplesPullEnvelope = z.object({
  rows: z.array(z.unknown()),
  next_seq: z.number(),
  has_more: z.boolean(),
});
export interface LexiconExamplesPullResult {
  /** Active and retired rows (a retired row removes the sentence from the local cache). */
  rows: LexiconExample[];
  /** Rows that did not validate (skipped; the cursor still moves past them). */
  invalid: number;
  next_seq: number;
  has_more: boolean;
}

/**
 * Shared example sentences of the lexicon senses the user has, changed after `sinceSeq`
 * (lexicon_examples_cursor). null when the backend does not have lexicon_examples_pull yet
 * (migration 20261022000100 not deployed): the client then treats examples as unavailable.
 */
export async function pullLexiconExamples(
  sinceSeq: number,
  limit = MAX_PULL_PAGE,
  c?: SupabaseClient | null,
): Promise<LexiconExamplesPullResult | null> {
  let env: z.infer<typeof examplesPullEnvelope>;
  try {
    env = await rpc(
      await client(c),
      'lexicon_examples_pull',
      { p_since: sinceSeq, p_limit: Math.min(limit, MAX_PULL_PAGE) },
      examplesPullEnvelope,
    );
  } catch (e) {
    if (isMissingFunction(e)) return null;
    throw e;
  }
  const rows: LexiconExample[] = [];
  let invalid = 0;
  for (const raw of env.rows) {
    const p = lexiconExampleSchema.safeParse(raw);
    if (p.success) rows.push(p.data);
    else invalid++;
  }
  return { rows, invalid, next_seq: env.next_seq, has_more: env.has_more };
}

/**
 * Active example sentences of the given lexicon senses (lexicon_examples_find, ≤ 200 ids).
 * Fills senses the user added after their sentences were shipped: those rows sit below the
 * device's lexicon_examples_cursor, so lexicon_examples_pull never returns them (decision
 * 0061). null when the backend does not have the function.
 */
export async function findLexiconExamples(
  senseIds: string[],
  c?: SupabaseClient | null,
): Promise<LexiconExample[] | null> {
  if (senseIds.length === 0) return [];
  if (senseIds.length > 200) throw new RangeError('at most 200 ids');
  let raw: unknown[];
  try {
    raw = await rpc(await client(c), 'lexicon_examples_find', { p_sense_ids: senseIds, p_band: null }, z.array(z.unknown()));
  } catch (e) {
    if (isMissingFunction(e)) return null;
    throw e;
  }
  const rows: LexiconExample[] = [];
  for (const r of raw) {
    const p = lexiconExampleSchema.safeParse(r);
    if (p.success) rows.push(p.data);
  }
  return rows;
}
