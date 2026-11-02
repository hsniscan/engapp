// Sync engine (docs/sync-strategy.md, plan "Hesap ve senkron").
//
//   push: outbox → sync_push in batches of 100; outbox rows are deleted only after the
//         server acks them; rejected rows back off exponentially (warn after 10 attempts).
//   pull: sync_pull from meta.sync_cursor in pages of 500 → applyRemoteRows; the cursor is
//         stored in the same Dexie transaction as the rows. full_resync: push everything,
//         re-pull from 0, drop local rows the server no longer has.
//   lexicon: lexicon_pull from meta.lexicon_cursor, then lexicon_get for referenced senses
//         missing from lexicon_cache.
//   examples: lexicon_examples_pull from meta.lexicon_examples_cursor (shared example
//         sentences of the user's lexicon senses), then lexicon_examples_find for senses
//         with no cached sentence (added after their sentences were shipped). content_feedback / user_content wait in
//         the outbox until that function has answered once (the server has the tables).
//   practice_logs wait in the outbox until a pull has been answered by sync_pull_v3 (the
//         server has the table): a client deployed before the migration does not burn the
//         rows' attempts on "unknown table" rejections. Tables added later (LATE_SYNC_TABLES:
//         İP5 feedback, decks, level tests, known words) wait until the server's table
//         registry lists them.
//   backfill: a table this device learned about in an app update is pulled once more from
//         the start (data/backfill.ts), since an older version skipped its rows.
//
// Triggers (startSyncEngine): app open, `online`, back to a visible tab, every 60 s while
// visible, shortly after local changes, requestSync() (end of a review session) and the
// "Şimdi senkronla" button (syncNow). One tab runs it at a time (src/sync/lock.ts).
import {
  ackOutboxItems,
  applyLexiconExamples,
  applyLexiconPage,
  applyPulledPage,
  applyRemoteRows,
  db,
  ensureSettings,
  failOutboxItems,
  getCurrentUserId,
  getCursor,
  getMeta,
  logError,
  META,
  PULL_BACKFILL_KEY,
  missingLexiconSenseIds,
  outboxKey,
  putLexiconSenses,
  removeRowsMissingOnServer,
  setMeta,
  takeOutboxItems,
  type OutboxItem,
  type RemoteBatch,
  type ResyncTable,
} from '@/data';
import type { Id, Millis, OutboxTable } from '@/domain/types';
import {
  getLexiconSenses,
  MAX_PULL_PAGE,
  MAX_PUSH_BATCH,
  listSyncTables,
  pullChanges,
  pullLexicon,
  pullLexiconExamples,
  findLexiconExamples,
  pushBatch,
  SyncApiError,
  type PulledRow,
  type PullResult,
  type PushItem,
  type PushResult,
  type LexiconPullResult,
  type LexiconExamplesPullResult,
} from './api';
import type { LexiconExample, LexiconSense } from '@/domain/types';

export const SYNC_INTERVAL_MS = 60_000;
/** Longest gap between background polls of a visible app that has nothing to sync. */
export const SYNC_IDLE_MAX_MS = 10 * 60_000;

/**
 * Delay before the next background poll (decision 0060): 60 s after a run that moved
 * something, then doubling with every run in a row that pushed and pulled nothing, up to
 * 10 minutes. Local changes, coming back to the app and going online still sync at once.
 */
export function nextPollDelayMs(idleRuns: number): number {
  return Math.min(SYNC_IDLE_MAX_MS, SYNC_INTERVAL_MS * 2 ** Math.max(0, Math.min(idleRuns, 10)));
}

/** A run that changed nothing on either side (counts towards the idle backoff). */
export function isIdleOutcome(o: SyncOutcome): boolean {
  if (!o.ok) return o.reason !== 'error';
  const r = o.report;
  return r.pushed === 0 && r.pulled === 0 && r.lexicon === 0 && r.removed === 0 && !r.fullResync;
}
/** Debounce between a local change and the push it triggers. */
export const CHANGE_DEBOUNCE_MS = 4_000;
export const LAST_SYNC_KEY = 'last_sync_at';
export const FULL_RESYNC_KEY = 'full_resync_pending';
const MAX_ROUNDS = 10_000; // guards against a server that keeps answering has_more
/** A purge can land between two pages of a full pull; start over at most this often. */
const MAX_FULL_PULL_RESTARTS = 3;

export interface SyncTransport {
  pushBatch(items: PushItem[]): Promise<PushResult>;
  /** `from`: the cursor this run of pages started at (see api.pullChanges). */
  pullChanges(since: number, limit?: number, from?: number): Promise<PullResult>;
  pullLexicon(since: number, limit?: number): Promise<LexiconPullResult>;
  getLexiconSenses(ids: Id[]): Promise<LexiconSense[]>;
  /** Shared example sentences (İP5). null: the backend does not have them yet. Optional so
   *  transports without examples (older tests) keep working: they count as "not yet". */
  pullLexiconExamples?(since: number, limit?: number): Promise<LexiconExamplesPullResult | null>;
  /** Active example sentences of these senses (≤ 200); null: the backend has no such call. */
  findLexiconExamples?(senseIds: Id[]): Promise<LexiconExample[] | null>;
  /**
   * Names in the server's sync table registry (null: the backend has no registry yet).
   * Absent on transports that predate it: they are assumed to store every table.
   */
  listSyncTables?(): Promise<string[] | null>;
}

/**
 * Synced tables added after the registry (v0.2 İP1). Their rows stay in the outbox until the
 * server's registry lists the table, so a new client against an older backend never burns
 * push attempts on "unknown table" rejections. Every package that adds a synced table adds
 * it here (and records a one-time re-pull in its Dexie upgrade, data/backfill.ts).
 */
export const LATE_SYNC_TABLES: readonly OutboxTable[] = [
  'content_feedback',
  'user_content',
  'decks',
  'level_tests',
  'known_terms',
  'weekly_reports',
  'texts',
  'encounters',
];
/** While rows of an unconfirmed table wait, the registry is asked at most this often. */
export const REGISTRY_RECHECK_MS = 10 * 60_000;

/** The device's own copies of text bodies (sync_pull_v4 leaves unchanged bodies out). */
async function localTextBodies(ids: string[]): Promise<Map<string, string>> {
  const rows = await db.texts.bulkGet(ids);
  const out = new Map<string, string>();
  for (const r of rows) if (r && typeof r.body === 'string') out.set(r.id, r.body);
  return out;
}

export const supabaseTransport: SyncTransport = {
  pushBatch: (items) => pushBatch(items),
  pullChanges: (since, limit, from) => pullChanges(since, limit, undefined, from, localTextBodies),
  pullLexicon: (since, limit) => pullLexicon(since, limit),
  getLexiconSenses: (ids) => getLexiconSenses(ids),
  pullLexiconExamples: (since, limit) => pullLexiconExamples(since, limit),
  findLexiconExamples: (ids) => findLexiconExamples(ids),
  listSyncTables: () => listSyncTables(),
};

/**
 * quota: the server refused the call for the account's daily sync quota (SQLSTATE 53400,
 * ADR 0060). Like 'network' it is not the rows' fault, so it does not count as a failed
 * attempt; the rows wait in the outbox until the quota resets.
 */
export type SyncErrorKind = 'network' | 'auth' | 'server' | 'quota';

/** "53400 ..." — the SQLSTATE of a refused sync quota (sync_limits, ADR 0060). */
export const isQuotaMessage = (message: string): boolean => /^53400\b/.test(message.trim());

export interface SyncReport {
  pushed: number;
  stale: number;
  rejected: number;
  pulled: number;
  fullResync: boolean;
  removed: number;
  lexicon: number;
}

export type SyncOutcome =
  | { ok: true; report: SyncReport }
  | { ok: false; reason: 'guest' | 'offline' | 'busy' | 'not_linked' }
  | { ok: false; reason: 'error'; error: SyncErrorKind; message: string; report: SyncReport };

class SyncFailure extends Error {
  readonly kind: SyncErrorKind;
  constructor(kind: SyncErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

function classify(e: unknown): SyncFailure {
  if (e instanceof SyncFailure) return e;
  if (e instanceof SyncApiError) {
    if (e.kind === 'network') return new SyncFailure('network', e.message);
    if (e.kind === 'not_signed_in' || e.kind === 'not_configured') return new SyncFailure('auth', e.message);
    if (isQuotaMessage(e.message)) return new SyncFailure('quota', e.message);
    return new SyncFailure('server', e.message);
  }
  return new SyncFailure('server', e instanceof Error ? e.message : String(e));
}

const emptyReport = (): SyncReport => ({ pushed: 0, stale: 0, rejected: 0, pulled: 0, fullResync: false, removed: 0, lexicon: 0 });

function toBatch(rows: PulledRow[]): RemoteBatch {
  const batch: RemoteBatch = {};
  for (const r of rows) (batch[r.table] ??= []).push(r.row);
  return batch;
}

export interface RunOptions {
  /** Ignore per-row backoff (manual "Şimdi senkronla"). */
  force?: boolean;
  now?: () => Millis;
}

/**
 * Push everything that is due. Network errors leave rows untouched (being offline is not
 * the row's fault); server errors and rejected rows count as failed attempts.
 */
export async function pushOutbox(t: SyncTransport, report: SyncReport, opts: RunOptions = {}): Promise<void> {
  const now = opts.now ?? Date.now;
  const skipTables = new Set<OutboxTable>((await getMeta<boolean>(META.serverPractice)) ? [] : ['practice_logs']);
  if (!(await getMeta<boolean>(META.serverExamples))) {
    skipTables.add('content_feedback');
    skipTables.add('user_content');
  }
  // The registry is asked at most once per sync run (a run pushes twice: before and after its pull).
  let lacking = lackingByRun.get(report);
  if (!lacking) lackingByRun.set(report, (lacking = await tablesServerLacks(t, now())));
  for (const table of lacking) skipTables.add(table);
  // Rows that failed in this run are not sent again in the same run (a forced run would
  // otherwise resend them with every batch and burn through their attempts at once).
  const failedThisRun = new Set<string>();
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const items = await takeOutboxItems(MAX_PUSH_BATCH, now(), opts.force, failedThisRun, skipTables);
    if (items.length === 0) return;
    let res: PushResult;
    try {
      res = await pushWithSlimTexts(t, items);
    } catch (e) {
      const f = classify(e);
      if (f.kind === 'server') await failOutboxItems(items, now());
      throw f;
    }
    const acked = new Set(res.acked);
    const rejected = new Set(res.rejected.map((r) => r.id).filter((x): x is string => !!x));
    const ok: OutboxItem[] = [];
    const failed: OutboxItem[] = [];
    for (const it of items) (acked.has(it.row_id) && !rejected.has(it.row_id) ? ok : failed).push(it);
    await ackOutboxItems(ok);
    await failOutboxItems(failed, now());
    for (const it of failed) failedThisRun.add(outboxKey(it));
    report.pushed += ok.length;
    report.stale += res.stale.length;
    report.rejected += failed.length;
    for (const r of res.rejected) void logError(`${r.code}: ${r.message}`, `sync.push rejected ${r.table ?? '?'}/${r.id ?? '?'}`);
    // Everything left was just rescheduled; a forced run must not spin on the same rows.
    if (ok.length === 0) return;
  }
}

/**
 * A text's body never changes after it is saved, so a change of reading progress, "Bitirdim",
 * feedback or a deletion is pushed without it (decision 0060): an update (updated_at after
 * created_at) or a delete. The server keeps its body; for a text it does not have yet it
 * answers 23502, and that row is sent again at once with its body.
 */
export function slimTextPayload(item: Pick<OutboxItem, 'table' | 'op' | 'payload'>): unknown {
  if (item.table !== 'texts' || !item.payload || typeof item.payload !== 'object') return item.payload;
  const p = item.payload as { body?: unknown; created_at?: unknown; updated_at?: unknown };
  if (typeof p.body !== 'string') return item.payload;
  const update = typeof p.updated_at === 'number' && typeof p.created_at === 'number' && p.updated_at > p.created_at;
  if (item.op !== 'delete' && !update) return item.payload;
  const rest: Record<string, unknown> = { ...(item.payload as Record<string, unknown>) };
  delete rest.body;
  return rest;
}

async function pushWithSlimTexts(t: SyncTransport, items: OutboxItem[]): Promise<PushResult> {
  const slim = new Set<string>();
  const wire = items.map((i): PushItem => {
    const payload = slimTextPayload(i);
    if (payload !== i.payload) slim.add(i.row_id);
    return { table: i.table, op: i.op, payload };
  });
  const res = await t.pushBatch(wire);
  const retry = items.filter(
    (i) => slim.has(i.row_id) && res.rejected.some((r) => r.id === i.row_id && r.table === i.table && r.code === '23502'),
  );
  if (retry.length === 0) return res;
  const again = await t.pushBatch(retry.map((i): PushItem => ({ table: i.table, op: i.op, payload: i.payload })));
  const retried = new Set(retry.map((i) => i.row_id));
  return {
    acked: [...res.acked.filter((id) => !retried.has(id)), ...again.acked],
    stale: [...res.stale.filter((id) => !retried.has(id)), ...again.stale],
    rejected: [...res.rejected.filter((r) => !(r.id && retried.has(r.id))), ...again.rejected],
  };
}

/** tablesServerLacks() result per sync run (keyed by the run's report). */
const lackingByRun = new WeakMap<SyncReport, OutboxTable[]>();

/**
 * LATE_SYNC_TABLES with queued rows that the server has not confirmed yet. Asks the registry
 * only while such rows wait, at most every REGISTRY_RECHECK_MS; a confirmed table is
 * remembered and never asked about again. A transport without a registry call (tests, older
 * fakes) is assumed to store every table.
 */
async function tablesServerLacks(t: SyncTransport, now: Millis): Promise<OutboxTable[]> {
  if (!t.listSyncTables) return [];
  const known = (await getMeta<string[]>(META.serverTables)) ?? [];
  const pending: OutboxTable[] = [];
  for (const table of LATE_SYNC_TABLES) {
    if (known.includes(table)) continue;
    const queued = await db.outbox.where('[table+row_id]').between([table, ''], [table, '\uffff']).count();
    if (queued > 0) pending.push(table);
  }
  if (pending.length === 0) return pending;
  const checkedAt = (await getMeta<number>(META.serverTablesCheckedAt)) ?? 0;
  // The throttle covers only tables the last check asked about: a table whose rows began to
  // wait after it is asked about now (v0.5.1: a saved text confirmed 'texts' first, and the
  // known words then waited ten minutes).
  const asked = (await getMeta<string[]>(META.serverTablesAsked)) ?? pending;
  const recent = now - checkedAt >= 0 && now - checkedAt < REGISTRY_RECHECK_MS;
  if (recent && pending.every((x) => asked.includes(x))) return pending;
  let registry: string[] | null;
  try {
    registry = await t.listSyncTables();
  } catch (e) {
    const f = classify(e);
    if (f.kind !== 'server') throw f;
    void logError(e, 'sync.registry');
    registry = null;
  }
  const listed = registry ?? []; // null: no registry yet (older backend), keep waiting
  const confirmed = pending.filter((x) => listed.includes(x));
  await db.transaction('rw', db.meta, async () => {
    await setMeta(META.serverTablesCheckedAt, now);
    await setMeta(META.serverTablesAsked, pending);
    if (confirmed.length) await setMeta(META.serverTables, [...known, ...confirmed]);
  });
  return pending.filter((x) => !listed.includes(x));
}

/**
 * Re-pull rows of tables this device learned about in an app update (data/backfill.ts):
 * pages from 0 up to the current cursor, applying only those tables' rows. The cursor is
 * not moved. Interrupted runs start over (the apply is idempotent: last writer wins).
 */
async function pullBackfill(t: SyncTransport, report: SyncReport, now: () => Millis): Promise<void> {
  const tables = (await getMeta<string[]>(PULL_BACKFILL_KEY)) ?? [];
  if (tables.length === 0) return;
  const until = await getCursor(META.syncCursor);
  let cursor = 0;
  for (let round = 0; round < MAX_ROUNDS && cursor < until; round++) {
    const page = await t.pullChanges(cursor, MAX_PULL_PAGE, 0);
    // An older backend has none of these tables; a purge means a full resync brings them.
    if (page.version < 3 || page.full_resync) break;
    const rows = page.rows.filter((r) => tables.includes(r.table) && r.seq <= until);
    if (rows.length) {
      await applyRemoteRows(toBatch(rows), now());
      report.pulled += rows.length;
    }
    cursor = page.next_seq;
    if (!page.has_more) break;
  }
  await db.transaction('rw', db.meta, () => setMeta(PULL_BACKFILL_KEY, []));
}

/** Remember whether the server stores practice_logs (it answered with sync_pull_v3). */
async function notePullVersion(page: PullResult): Promise<void> {
  const supported = page.version >= 3;
  if (((await getMeta<boolean>(META.serverPractice)) ?? false) !== supported) {
    await db.transaction('rw', db.meta, () => setMeta(META.serverPractice, supported));
  }
}

/** Incremental pull. Returns true when the server asked for a full resync. */
async function pullAll(t: SyncTransport, report: SyncReport, now: () => Millis): Promise<boolean> {
  const start = await getCursor(META.syncCursor);
  let cursor = start;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const page = await t.pullChanges(cursor, MAX_PULL_PAGE, start);
    await notePullVersion(page);
    if (page.full_resync) return true;
    for (const bad of page.invalid) void logError(bad.error, `sync.pull invalid ${bad.table}/${String(bad.id)}`);
    await applyPulledPage(toBatch(page.rows), page.next_seq, now());
    report.pulled += page.rows.length;
    cursor = page.next_seq;
    if (!page.has_more) return false;
  }
  return false;
}

/**
 * Full resync (device offline longer than the server keeps tombstones): push the outbox
 * first, then pull everything from 0 and drop local rows the server no longer has. A flag
 * in meta makes an interrupted resync start over.
 */
async function fullResync(t: SyncTransport, report: SyncReport, now: () => Millis): Promise<void> {
  report.fullResync = true;
  await db.transaction('rw', db.meta, () => setMeta(FULL_RESYNC_KEY, true));
  // Rows the server keeps rejecting stay in the outbox; the cleanup below never removes them.
  await pushOutbox(t, report, { force: true, now });
  const emptySeen = (): Record<ResyncTable, Set<Id>> => ({
    notes: new Set(),
    senses: new Set(),
    cards: new Set(),
    sources: new Set(),
    settings: new Set(),
    content_feedback: new Set(),
    user_content: new Set(),
    decks: new Set(),
    known_terms: new Set(),
    texts: new Set(),
    encounters: new Set(),
  });
  let seen = emptySeen();
  let cursor = 0;
  let restarts = 0;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const page = await t.pullChanges(cursor, MAX_PULL_PAGE, 0);
    await notePullVersion(page);
    if (page.full_resync) {
      // Tombstones were purged past our cursor while we were paging: the pages we have are
      // fine, but `seen` would miss every row of the pages not pulled yet, and removing
      // "missing" rows would wipe them locally. Start the full pull over.
      if (++restarts > MAX_FULL_PULL_RESTARTS) throw new SyncFailure('server', 'full resync kept restarting');
      seen = emptySeen();
      cursor = 0;
      continue;
    }
    for (const r of page.rows) if (r.table in seen) seen[r.table as ResyncTable].add((r.row as { id: Id }).id);
    for (const bad of page.invalid) {
      // An invalid row still exists on the server: never delete it locally.
      if (bad.table in seen && typeof bad.id === 'string') seen[bad.table as ResyncTable].add(bad.id);
    }
    await applyPulledPage(toBatch(page.rows), page.next_seq, now());
    report.pulled += page.rows.length;
    cursor = page.next_seq;
    if (!page.has_more) break;
  }
  report.removed = await removeRowsMissingOnServer(seen, now());
  await db.transaction('rw', db.meta, () => setMeta(FULL_RESYNC_KEY, false));
}

/** Lexicon rows referenced by the user's senses: corrections via the cursor, gaps by id. */
async function pullLexiconCache(t: SyncTransport, report: SyncReport): Promise<void> {
  let cursor = await getCursor(META.lexiconCursor);
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const page = await t.pullLexicon(cursor, MAX_PULL_PAGE);
    await applyLexiconPage(page.rows, page.next_seq);
    report.lexicon += page.rows.length;
    cursor = page.next_seq;
    if (!page.has_more) break;
  }
  const missing = await missingLexiconSenseIds();
  for (let i = 0; i < missing.length; i += 500) {
    const rows = await t.getLexiconSenses(missing.slice(i, i + 500));
    await putLexiconSenses(rows);
    report.lexicon += rows.length;
  }
}

/**
 * Example sentences of the user's lexicon senses (lexicon_examples_pull). The first answer
 * also tells us the server stores content_feedback / user_content (META.serverExamples).
 */
async function pullExamplesCache(t: SyncTransport): Promise<void> {
  if (!t.pullLexiconExamples) return;
  let cursor = await getCursor(META.lexiconExamplesCursor);
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const page = await t.pullLexiconExamples(cursor, MAX_PULL_PAGE);
    const supported = page !== null;
    if (((await getMeta<boolean>(META.serverExamples)) ?? false) !== supported) {
      await db.transaction('rw', db.meta, () => setMeta(META.serverExamples, supported));
    }
    if (!page) return;
    if (page.invalid) void logError(`${page.invalid} invalid rows`, 'sync.examples');
    await applyLexiconExamples(page.rows, page.next_seq);
    cursor = page.next_seq;
    if (!page.has_more) return;
  }
}

/** Senses already asked by fillNewSenseExamples that had no sentences (meta, device-local). */
export const EXAMPLES_CHECKED_KEY = 'lexicon_examples_checked';
const FIND_CHUNK = 200;

/**
 * Sentences of senses the user added after those sentences were shipped. Their rows sit
 * below lexicon_examples_cursor, so the pull above never returns them (decision 0061: there
 * is no on-demand generation to fill the gap any more). Asks lexicon_examples_find once per
 * sense that has no cached sentence; a sense that had none is remembered, since sentences
 * shipped for it later arrive through the cursor. The cursor is not moved.
 */
async function fillNewSenseExamples(t: SyncTransport): Promise<void> {
  if (!t.findLexiconExamples || !(await getMeta<boolean>(META.serverExamples))) return;
  const live = await db.senses.filter((s) => !s.deleted_at && !!s.lexicon_sense_id).toArray();
  const checked = new Set((await getMeta<string[]>(EXAMPLES_CHECKED_KEY)) ?? []);
  const wanted = [...new Set(live.map((s) => s.lexicon_sense_id as Id))].filter((id) => !checked.has(id));
  if (wanted.length === 0) return;
  const cached = new Set(
    (await db.lexicon_examples.where('sense_id').anyOf(wanted).toArray()).map((e) => e.sense_id),
  );
  const missing = wanted.filter((id) => !cached.has(id));
  for (let i = 0; i < missing.length; i += FIND_CHUNK) {
    const ids = missing.slice(i, i + FIND_CHUNK);
    const rows = await t.findLexiconExamples(ids);
    if (rows === null) return;
    await applyLexiconExamples(rows);
    const found = new Set(rows.map((r) => r.sense_id));
    for (const id of ids) if (!found.has(id)) checked.add(id);
    await db.transaction('rw', db.meta, () => setMeta(EXAMPLES_CHECKED_KEY, [...checked]));
  }
}

/**
 * One complete sync round for the linked account. Exported for tests and for the account
 * linking flow; the app uses the SyncEngine below (locking, triggers, status).
 */
export async function runSync(t: SyncTransport, opts: RunOptions = {}): Promise<SyncReport> {
  const now = opts.now ?? Date.now;
  const report = emptyReport();
  if (await getMeta<boolean>(FULL_RESYNC_KEY)) {
    await fullResync(t, report, now);
  } else {
    await pushOutbox(t, report, opts);
    if (await pullAll(t, report, now)) await fullResync(t, report, now);
  }
  try {
    await pullExamplesCache(t);
    await fillNewSenseExamples(t);
  } catch (e) {
    // Example sentences are extras; user data is already in sync.
    void logError(e, 'sync.examples');
  }
  // After a full resync every row was pulled; otherwise re-pull late tables once if needed.
  if (report.fullResync) await db.transaction('rw', db.meta, () => setMeta(PULL_BACKFILL_KEY, []));
  else await pullBackfill(t, report, now);
  // Rows pulled between our push and pull may have triggered recomputes (queued), and
  // feedback rows wait for the first examples pull: push them.
  if ((await db.outbox.count()) > 0) await pushOutbox(t, report, { ...opts, force: false });
  try {
    await pullLexiconCache(t, report);
  } catch (e) {
    // The dictionary cache is a convenience; user data is already in sync.
    void logError(e, 'sync.lexicon');
  }
  if (!(await db.settings.get('settings'))) await ensureSettings(now());
  await db.transaction('rw', db.meta, () => setMeta(LAST_SYNC_KEY, now()));
  return report;
}

// ------------------------------------------------------------------ engine (status, triggers)

export interface EngineSnapshot {
  running: boolean;
  /** Last run's failure, cleared by the next successful run. */
  error: SyncErrorKind | null;
  errorMessage: string | null;
  online: boolean;
  /** A signed-in session whose account is linked to this device's data. */
  active: boolean;
}

export interface SyncEngineDeps {
  transport: SyncTransport;
  /** Signed-in user of the current session, or null (guest / signed out). */
  getSessionUserId: () => Promise<string | null>;
  isOnline?: () => boolean;
  now?: () => Millis;
  runner?: { run<T>(fn: () => Promise<T>): Promise<T | undefined> };
}

type Listener = () => void;

export class SyncEngine {
  private snapshot: EngineSnapshot;
  private readonly listeners = new Set<Listener>();
  private readonly deps: Required<Omit<SyncEngineDeps, 'runner'>> & Pick<SyncEngineDeps, 'runner'>;
  private inflight: Promise<SyncOutcome> | null = null;
  private again: RunOptions | null = null;

  constructor(deps: SyncEngineDeps) {
    this.deps = {
      isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine),
      now: Date.now,
      ...deps,
    };
    this.snapshot = { running: false, error: null, errorMessage: null, online: this.deps.isOnline(), active: false };
  }

  getSnapshot = (): EngineSnapshot => this.snapshot;

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  setState(patch: Partial<EngineSnapshot>): void {
    const next = { ...this.snapshot, ...patch };
    if ((Object.keys(patch) as (keyof EngineSnapshot)[]).every((k) => next[k] === this.snapshot[k])) return;
    this.snapshot = next;
    for (const l of this.listeners) l();
  }

  /** Is there a linked, signed-in account to sync? */
  async isActive(): Promise<boolean> {
    const session = await this.deps.getSessionUserId();
    const linked = await getCurrentUserId();
    const active = session !== null && session === linked;
    this.setState({ active });
    return active;
  }

  /**
   * Run one sync now (coalesced: a call during a run schedules one more run afterwards).
   * Never throws; the outcome says what happened.
   */
  sync(opts: Omit<RunOptions, 'now'> = {}): Promise<SyncOutcome> {
    if (this.inflight) {
      this.again = { force: (this.again?.force ?? false) || !!opts.force };
      return this.inflight;
    }
    this.inflight = this.runGuarded(opts).finally(() => {
      this.inflight = null;
      const next = this.again;
      this.again = null;
      if (next) void this.sync(next);
    });
    return this.inflight;
  }

  /**
   * The transport for one run, bound to the account the run started with: before every
   * request the session must still be that account and the device still linked to it. A
   * sign-out / sign-in as someone else (e.g. in another tab) during a run would otherwise
   * send this device's rows with the new account's token.
   */
  private guardedTransport(userId: string): SyncTransport {
    const t = this.deps.transport;
    const check = async () => {
      const [session, linked] = await Promise.all([this.deps.getSessionUserId(), getCurrentUserId()]);
      if (session !== userId || linked !== userId) throw new SyncFailure('auth', 'The signed-in account changed during sync');
    };
    return {
      pushBatch: async (items) => (await check(), t.pushBatch(items)),
      pullChanges: async (since, limit, from) => (await check(), t.pullChanges(since, limit, from)),
      pullLexicon: async (since, limit) => (await check(), t.pullLexicon(since, limit)),
      getLexiconSenses: async (ids) => (await check(), t.getLexiconSenses(ids)),
      ...(t.pullLexiconExamples
        ? { pullLexiconExamples: async (since: number, limit?: number) => (await check(), t.pullLexiconExamples!(since, limit)) }
        : {}),
      ...(t.findLexiconExamples
        ? { findLexiconExamples: async (ids: Id[]) => (await check(), t.findLexiconExamples!(ids)) }
        : {}),
      ...(t.listSyncTables
        ? { listSyncTables: async () => (await check(), t.listSyncTables!()) }
        : {}),
    };
  }

  private async runGuarded(opts: Omit<RunOptions, 'now'>): Promise<SyncOutcome> {
    const online = this.deps.isOnline();
    this.setState({ online });
    const session = await this.deps.getSessionUserId();
    if (!session) {
      this.setState({ active: false, error: null, errorMessage: null });
      return { ok: false, reason: 'guest' };
    }
    if (!(await this.isActive())) return { ok: false, reason: 'not_linked' };
    if (!online) return { ok: false, reason: 'offline' };
    const transport = this.guardedTransport(session);
    const work = async (): Promise<SyncOutcome> => {
      this.setState({ running: true });
      try {
        const report = await runSync(transport, { ...opts, now: this.deps.now });
        this.setState({ running: false, error: null, errorMessage: null });
        return { ok: true, report };
      } catch (e) {
        const f = classify(e);
        if (f.kind !== 'network' && f.kind !== 'quota') void logError(e, 'sync.run');
        this.setState({ running: false, error: f.kind, errorMessage: f.message, online: f.kind === 'network' ? this.deps.isOnline() : online });
        return { ok: false, reason: 'error', error: f.kind, message: f.message, report: emptyReport() };
      }
    };
    const out = this.deps.runner ? await this.deps.runner.run(work) : await work();
    return out ?? { ok: false, reason: 'busy' };
  }
}
