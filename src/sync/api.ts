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
  noteSchema,
  practiceLogSchema,
  reviewLogSchema,
  senseSchema,
  settingsSchema,
  sourceSchema,
  userContentSchema,
} from '@/domain/schemas';
import type {
  Card,
  ContentFeedback,
  LexiconExample,
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
import { supabase } from '@/lib/supabase';

export const MAX_PUSH_BATCH = 100;
export const MAX_PULL_PAGE = 500;

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
};

const pullEnvelope = z.object({
  rows: z.array(
    z.object({ table: z.string(), seq: z.number(), row: z.record(z.string(), z.unknown()) }),
  ),
  next_seq: z.number(),
  has_more: z.boolean(),
  full_resync: z.boolean(),
});

export interface PullResult {
  rows: PulledRow[];
  /** Rows the client could not validate (logged; the cursor still moves past them). */
  invalid: { table: string; seq: number; id: unknown; error: string }[];
  next_seq: number;
  has_more: boolean;
  full_resync: boolean;
  /**
   * The pull function that answered: 3 = sync_pull_v3 (the server stores practice_logs),
   * 2 = sync_pull_v2, 1 = sync_pull. Older backends are used until the migrations land.
   */
  version: 1 | 2 | 3;
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

function client(c?: SupabaseClient | null): SupabaseClient {
  const s = c === undefined ? supabase : c;
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
  return rpc(client(c), 'sync_push', { p_batch: items }, pushResult);
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
): Promise<PullResult> {
  const cl = client(c);
  const p_limit = Math.min(limit, MAX_PULL_PAGE);
  let env: z.infer<typeof pullEnvelope> | null = null;
  let version: PullResult['version'] = 1;
  if (fromSeq !== undefined) {
    for (const [fn, v] of [['sync_pull_v3', 3], ['sync_pull_v2', 2]] as const) {
      try {
        env = await rpc(cl, fn, { p_since: sinceSeq, p_limit, p_from: fromSeq }, pullEnvelope);
        version = v;
        break;
      } catch (e) {
        if (!isMissingFunction(e)) throw e;
      }
    }
  }
  env ??= await rpc(cl, 'sync_pull', { p_since: sinceSeq, p_limit }, pullEnvelope);
  const rows: PulledRow[] = [];
  const invalid: PullResult['invalid'] = [];
  for (const r of env.rows) {
    const schema = ROW_SCHEMAS[r.table as OutboxTable];
    if (!schema) {
      invalid.push({ table: r.table, seq: r.seq, id: r.row.id, error: 'unknown table' });
      continue;
    }
    const p = schema.safeParse(r.row);
    if (p.success) rows.push({ table: r.table, seq: r.seq, row: p.data } as PulledRow);
    else invalid.push({ table: r.table, seq: r.seq, id: r.row.id, error: p.error.message });
  }
  return {
    rows,
    invalid,
    next_seq: env.next_seq,
    has_more: env.has_more,
    full_resync: env.full_resync,
    version,
  };
}

/** Lexicon senses referenced by the user's senses, changed after `sinceSeq` (lexicon_cursor). */
export async function pullLexicon(
  sinceSeq: number,
  limit = MAX_PULL_PAGE,
  c?: SupabaseClient | null,
): Promise<LexiconPullResult> {
  return rpc(
    client(c),
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
  return rpc(client(c), 'lexicon_get', { p_ids: ids }, z.array(lexiconEntry));
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
      client(c),
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
