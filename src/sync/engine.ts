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
//         sentences of the user's lexicon senses). content_feedback / user_content wait in
//         the outbox until that function has answered once (the server has the tables).
//   practice_logs wait in the outbox until a pull has been answered by sync_pull_v3 (the
//         server has the table): a client deployed before the migration does not burn the
//         rows' attempts on "unknown table" rejections.
//
// Triggers (startSyncEngine): app open, `online`, back to a visible tab, every 60 s while
// visible, shortly after local changes, requestSync() (end of a review session) and the
// "Şimdi senkronla" button (syncNow). One tab runs it at a time (src/sync/lock.ts).
import {
  ackOutboxItems,
  applyLexiconExamples,
  applyLexiconPage,
  applyPulledPage,
  db,
  ensureSettings,
  failOutboxItems,
  getCurrentUserId,
  getCursor,
  getMeta,
  logError,
  META,
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
  pullChanges,
  pullLexicon,
  pullLexiconExamples,
  pushBatch,
  SyncApiError,
  type PulledRow,
  type PullResult,
  type PushItem,
  type PushResult,
  type LexiconPullResult,
  type LexiconExamplesPullResult,
} from './api';
import type { LexiconSense } from '@/domain/types';

export const SYNC_INTERVAL_MS = 60_000;
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
}

export const supabaseTransport: SyncTransport = {
  pushBatch: (items) => pushBatch(items),
  pullChanges: (since, limit, from) => pullChanges(since, limit, undefined, from),
  pullLexicon: (since, limit) => pullLexicon(since, limit),
  getLexiconSenses: (ids) => getLexiconSenses(ids),
  pullLexiconExamples: (since, limit) => pullLexiconExamples(since, limit),
};

export type SyncErrorKind = 'network' | 'auth' | 'server';

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
  // Rows that failed in this run are not sent again in the same run (a forced run would
  // otherwise resend them with every batch and burn through their attempts at once).
  const failedThisRun = new Set<string>();
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const items = await takeOutboxItems(MAX_PUSH_BATCH, now(), opts.force, failedThisRun, skipTables);
    if (items.length === 0) return;
    let res: PushResult;
    try {
      res = await t.pushBatch(items.map((i): PushItem => ({ table: i.table, op: i.op, payload: i.payload })));
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
    for (const r of page.rows) if (r.table in seen) seen[r.table as ResyncTable].add(r.row.id);
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
  } catch (e) {
    // Example sentences are extras; user data is already in sync.
    void logError(e, 'sync.examples');
  }
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
        if (f.kind !== 'network') void logError(e, 'sync.run');
        this.setState({ running: false, error: f.kind, errorMessage: f.message, online: f.kind === 'network' ? this.deps.isOnline() : online });
        return { ok: false, reason: 'error', error: f.kind, message: f.message, report: emptyReport() };
      }
    };
    const out = this.deps.runner ? await this.deps.runner.run(work) : await work();
    return out ?? { ok: false, reason: 'busy' };
  }
}
