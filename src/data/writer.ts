// The single write path for synced tables. Every change stamps updated_at + hlc and adds an
// outbox row in the SAME Dexie transaction, so a crash can never leave a change unsynced.
import type { Table } from 'dexie';
import { decodeHlc, encodeHlc, type Hlc, isHlc, receive, tick } from '../domain/hlc';
import { uuidv7 } from '../domain/ids';
import type {
  Card,
  ContentFeedback,
  Deck,
  Id,
  KnownTerm,
  LevelTest,
  Millis,
  Note,
  OutboxRow,
  OutboxTable,
  PracticeLog,
  ReviewLog,
  Sense,
  Settings,
  Source,
  SyncedRow,
  UserContent,
} from '../domain/types';
import { db } from './db';
import { getDeviceId, getMeta, META, setMeta } from './meta';

export interface MutableRows {
  notes: Note;
  senses: Sense;
  cards: Card;
  sources: Source;
  settings: Settings;
  content_feedback: ContentFeedback;
  user_content: UserContent;
  decks: Deck;
  known_terms: KnownTerm;
}
export type MutableTable = keyof MutableRows;

export class SyncWriter {
  private clock: Hlc;
  private readonly pending: OutboxRow[] = [];
  readonly now: Millis;
  readonly userId: string | null;
  readonly deviceId: string;

  constructor(now: Millis, clock: Hlc, userId: string | null, deviceId: string) {
    this.now = now;
    this.clock = clock;
    this.userId = userId;
    this.deviceId = deviceId;
  }

  nextHlc(): string {
    this.clock = tick(this.clock, this.now);
    return encodeHlc(this.clock);
  }

  /** Merge a remote/restored timestamp so later local edits order after it. */
  observe(hlc: string): void {
    if (isHlc(hlc)) this.clock = receive(this.clock, decodeHlc(hlc), this.now);
  }

  newId(): Id {
    return uuidv7(this.now);
  }

  /** Synced columns for a brand-new row. */
  base(id: Id = this.newId()): SyncedRow {
    return { id, user_id: this.userId, created_at: this.now, updated_at: this.now, deleted_at: null, hlc: this.nextHlc() };
  }

  /** Stamp (updated_at, hlc), store and enqueue. */
  async put<T extends MutableTable>(table: T, row: MutableRows[T]): Promise<MutableRows[T]> {
    const stamped = { ...row, updated_at: this.now, hlc: this.nextHlc() };
    await (db.table(table) as Table<MutableRows[T], Id>).put(stamped);
    this.enqueue(table, stamped.id, stamped.deleted_at !== null ? 'delete' : 'upsert', stamped);
    return stamped;
  }

  /** Store a row exactly as given (restore) and enqueue it. */
  async putAsIs<T extends MutableTable>(table: T, row: MutableRows[T]): Promise<void> {
    this.observe(row.hlc);
    await (db.table(table) as Table<MutableRows[T], Id>).put(row);
    this.enqueue(table, row.id, row.deleted_at !== null ? 'delete' : 'upsert', row);
  }

  /** put() for many rows of one table: one bulkPut, same stamps and outbox rows as put(). */
  async putMany<T extends MutableTable>(table: T, rows: readonly MutableRows[T][]): Promise<MutableRows[T][]> {
    if (rows.length === 0) return [];
    const stamped = rows.map((row) => ({ ...row, updated_at: this.now, hlc: this.nextHlc() }));
    await (db.table(table) as Table<MutableRows[T], Id>).bulkPut(stamped);
    for (const row of stamped) this.enqueue(table, row.id, row.deleted_at !== null ? 'delete' : 'upsert', row);
    return stamped;
  }

  /** putAsIs() for many rows of one table (restore): one bulkPut. */
  async putManyAsIs<T extends MutableTable>(table: T, rows: readonly MutableRows[T][]): Promise<void> {
    if (rows.length === 0) return;
    for (const row of rows) this.observe(row.hlc);
    await (db.table(table) as Table<MutableRows[T], Id>).bulkPut([...rows]);
    for (const row of rows) this.enqueue(table, row.id, row.deleted_at !== null ? 'delete' : 'upsert', row);
  }

  /** review_logs are insert-only: add() fails if the id exists. */
  async insertLog(log: ReviewLog): Promise<void> {
    await db.review_logs.add(log);
    this.enqueue('review_logs', log.id, 'upsert', log);
  }

  /**
   * Many new logs at once (history reset, restore); bulkAdd fails if an id exists.
   * `queue: false` only for a guest's restore: adoptGuestData queues every log anyway.
   */
  async insertLogs(logs: ReviewLog[], queue = true): Promise<void> {
    if (logs.length === 0) return;
    await db.review_logs.bulkAdd(logs);
    if (queue) for (const log of logs) this.enqueue('review_logs', log.id, 'upsert', log);
  }

  /** practice_logs are insert-only too, and never touch cards or review_logs. */
  async insertPracticeLog(log: PracticeLog): Promise<void> {
    await db.practice_logs.add(log);
    this.enqueue('practice_logs', log.id, 'upsert', log);
  }

  /** Many practice logs at once (restore); bulkAdd fails if an id exists. `queue`: see insertLogs. */
  async insertPracticeLogs(logs: readonly PracticeLog[], queue = true): Promise<void> {
    if (logs.length === 0) return;
    await db.practice_logs.bulkAdd([...logs]);
    if (queue) for (const log of logs) this.enqueue('practice_logs', log.id, 'upsert', log);
  }

  /** level_tests are insert-only: a finished test is never changed. */
  async insertLevelTest(test: LevelTest): Promise<void> {
    await db.level_tests.add(test);
    this.enqueue('level_tests', test.id, 'upsert', test);
  }

  /** Many level tests at once (restore); bulkAdd fails if an id exists. `queue`: see insertLogs. */
  async insertLevelTests(tests: readonly LevelTest[], queue = true): Promise<void> {
    if (tests.length === 0) return;
    await db.level_tests.bulkAdd([...tests]);
    if (queue) for (const test of tests) this.enqueue('level_tests', test.id, 'upsert', test);
  }

  enqueue(table: OutboxTable, rowId: Id, op: OutboxRow['op'], payload: unknown): void {
    this.pending.push({ table, row_id: rowId, op, payload, attempts: 0, next_attempt_at: this.now });
  }

  async flush(): Promise<void> {
    if (this.pending.length) await db.outbox.bulkAdd(this.pending.splice(0));
    await setMeta(META.hlc, encodeHlc(this.clock));
  }
}

async function openWriter(now: Millis): Promise<SyncWriter> {
  const deviceId = (await getMeta<string>(META.deviceId)) ?? (await getDeviceId());
  const userId = (await getMeta<string | null>(META.userId)) ?? null;
  const stored = await getMeta<string>(META.hlc);
  const clock: Hlc = stored && isHlc(stored) ? { ...decodeHlc(stored), node: deviceId } : { ms: 0, counter: 0, node: deviceId };
  return new SyncWriter(now, clock, userId, deviceId);
}

/**
 * Run `fn` in one rw transaction over `tables` + outbox + meta, with a writer whose
 * outbox rows and clock are flushed before the transaction commits.
 */
export function writeTx<R>(tables: Table[], now: Millis, fn: (w: SyncWriter) => Promise<R>): Promise<R> {
  return db.transaction('rw', [...tables, db.outbox, db.meta], async () => {
    const w = await openWriter(now);
    const result = await fn(w);
    await w.flush();
    return result;
  });
}
