// The single write path for synced tables. Every change stamps updated_at + hlc and adds an
// outbox row in the SAME Dexie transaction, so a crash can never leave a change unsynced.
import type { Table } from 'dexie';
import { decodeHlc, encodeHlc, type Hlc, isHlc, receive, tick } from '../domain/hlc';
import { uuidv7 } from '../domain/ids';
import type { Card, Id, Millis, Note, OutboxRow, OutboxTable, ReviewLog, Sense, Settings, Source, SyncedRow } from '../domain/types';
import { db } from './db';
import { getDeviceId, getMeta, META, setMeta } from './meta';

export interface MutableRows {
  notes: Note;
  senses: Sense;
  cards: Card;
  sources: Source;
  settings: Settings;
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

  /** review_logs are insert-only: add() fails if the id exists. */
  async insertLog(log: ReviewLog): Promise<void> {
    await db.review_logs.add(log);
    this.enqueue('review_logs', log.id, 'upsert', log);
  }

  /** Many new logs at once (history reset); bulkAdd fails if an id exists. */
  async insertLogs(logs: ReviewLog[]): Promise<void> {
    if (logs.length === 0) return;
    await db.review_logs.bulkAdd(logs);
    for (const log of logs) this.enqueue('review_logs', log.id, 'upsert', log);
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
