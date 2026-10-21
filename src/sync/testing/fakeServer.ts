// In-memory stand-in for sync_push / sync_pull / lexicon_pull / lexicon_get with the same
// rules as supabase/migrations/20261021000400_sync.sql (LWW by HLC, append-only logs,
// server_seq cursor, tombstone purge → full_resync) and 20261021000900_practice.sql
// (practice_logs: insert-only, pulled only by sync_pull_v3). Test-only.
import type { Id, LexiconSense, OutboxTable } from '@/domain/types';
import { db } from '@/data';
import type { SyncTransport } from '../engine';
import { SyncApiError, type PulledRow, type PullResult, type PushItem, type PushResult } from '../api';

interface Stored {
  table: OutboxTable;
  row: Record<string, unknown> & { id: string };
  seq: number;
}

export class FakeServer implements SyncTransport {
  readonly rows = new Map<string, Stored>();
  private seq = 0;
  purgedThrough = 0;
  readonly lexicon = new Map<Id, { row: LexiconSense; seq: number }>();
  private lexSeq = 0;
  /** Calls made, for assertions. */
  readonly calls = { push: 0, pull: 0, lexiconPull: 0, lexiconGet: 0 };
  /** Fault injection. */
  faults: {
    /** Throw a network error before the server applies the batch (n times). */
    networkBeforePush?: number;
    /** Apply the batch, then lose the response (n times). */
    networkAfterPush?: number;
    /** Push call index (1-based) that fails with a network error before applying. */
    dropOnPushCall?: number;
    rejectIds?: Set<string>;
    offline?: boolean;
  } = {};

  /**
   * false = a backend from before migration 20261021000900: sync_push rejects practice_logs
   * as an unknown table and pulls answer like sync_pull_v2 (version 2, no practice rows).
   */
  practiceSupported = true;

  readonly userId: string;
  constructor(userId = 'user-1') {
    this.userId = userId;
  }

  private key(table: string, id: string) {
    return `${table}:${id}`;
  }

  async pushBatch(items: PushItem[]): Promise<PushResult> {
    this.calls.push++;
    if (this.faults.offline) throw new SyncApiError('network', 'offline');
    if (this.faults.dropOnPushCall === this.calls.push) throw new SyncApiError('network', 'connection reset');
    if (this.faults.networkBeforePush) {
      this.faults.networkBeforePush--;
      throw new SyncApiError('network', 'Failed to fetch');
    }
    if (items.length > 100) throw new SyncApiError('server', '22023 too many');
    const res: PushResult = { acked: [], stale: [], rejected: [] };
    for (const it of items) {
      const p = structuredClone(it.payload) as Record<string, unknown> & { id: string; hlc: string };
      if (this.faults.rejectIds?.has(p.id)) {
        res.rejected.push({ table: it.table, id: p.id, code: '23502', message: 'not-null violation' });
        continue;
      }
      if (it.table === 'practice_logs' && !this.practiceSupported) {
        res.rejected.push({ table: it.table, id: p.id, code: '22023', message: 'unknown table' });
        continue;
      }
      const insertOnly = it.table === 'review_logs' || it.table === 'practice_logs';
      if (insertOnly && it.op === 'delete') {
        res.rejected.push({ table: it.table, id: p.id, code: '42501', message: 'logs are append-only' });
        continue;
      }
      const k = this.key(it.table, p.id);
      const cur = this.rows.get(k);
      p.user_id = this.userId;
      if (insertOnly) {
        if (!cur) this.rows.set(k, { table: it.table, row: p, seq: ++this.seq });
        res.acked.push(p.id);
        continue;
      }
      if (cur && !(p.hlc > (cur.row.hlc as string))) {
        res.acked.push(p.id);
        res.stale.push(p.id);
        continue;
      }
      this.rows.set(k, { table: it.table, row: p, seq: ++this.seq });
      res.acked.push(p.id);
    }
    if (this.faults.networkAfterPush) {
      this.faults.networkAfterPush--;
      throw new SyncApiError('network', 'response lost');
    }
    return res;
  }

  /**
   * `from` as in sync_pull_v2/v3 (the cursor the pull started at); omitted = old sync_pull.
   * Answers as sync_pull_v3 (with practice_logs) when practiceSupported, else as v2/v1.
   */
  async pullChanges(since: number, limit = 500, from?: number): Promise<PullResult> {
    this.calls.pull++;
    if (this.faults.offline) throw new SyncApiError('network', 'offline');
    const version: PullResult['version'] = from === undefined ? 1 : this.practiceSupported ? 3 : 2;
    const start = from === undefined ? since : Math.min(Math.max(from, 0), since);
    if (start > 0 && start < this.purgedThrough) {
      return { rows: [], invalid: [], next_seq: since, has_more: false, full_resync: true, version };
    }
    const all = [...this.rows.values()]
      .filter((r) => r.seq > since && (version === 3 || r.table !== 'practice_logs'))
      .sort((a, b) => a.seq - b.seq);
    const page = all.slice(0, Math.min(limit, 500));
    return {
      rows: page.map((r) => ({ table: r.table, seq: r.seq, row: structuredClone(r.row) }) as unknown as PulledRow),
      invalid: [],
      next_seq: page.length ? page[page.length - 1]!.seq : since,
      has_more: all.length > page.length,
      full_resync: false,
      version,
    };
  }

  /** purge_tombstones: drop every tombstone, remember the highest purged seq. */
  purgeTombstones(): number {
    let n = 0;
    for (const [k, r] of this.rows) {
      if (r.table !== 'review_logs' && r.table !== 'practice_logs' && r.row.deleted_at != null) {
        this.purgedThrough = Math.max(this.purgedThrough, r.seq);
        this.rows.delete(k);
        n++;
      }
    }
    return n;
  }

  addLexicon(row: LexiconSense): void {
    this.lexicon.set(row.id, { row, seq: ++this.lexSeq });
  }

  private referenced(): Set<Id> {
    const ids = new Set<Id>();
    for (const r of this.rows.values()) if (r.table === 'senses' && r.row.lexicon_sense_id) ids.add(r.row.lexicon_sense_id as Id);
    return ids;
  }

  async pullLexicon(since: number, limit = 500) {
    this.calls.lexiconPull++;
    if (this.faults.offline) throw new SyncApiError('network', 'offline');
    const ref = this.referenced();
    const all = [...this.lexicon.values()].filter((l) => l.seq > since && ref.has(l.row.id)).sort((a, b) => a.seq - b.seq);
    const page = all.slice(0, limit);
    return { rows: page.map((p) => p.row), next_seq: page.length ? page[page.length - 1]!.seq : since, has_more: all.length > page.length };
  }

  async getLexiconSenses(ids: Id[]) {
    this.calls.lexiconGet++;
    return ids.map((id) => this.lexicon.get(id)?.row).filter((x): x is LexiconSense => !!x);
  }

  rowsOf(table: OutboxTable) {
    return [...this.rows.values()].filter((r) => r.table === table).map((r) => r.row);
  }
}

// ------------------------------------------------------------------ virtual devices

export type DeviceImage = Record<string, unknown[]>;

/** Snapshot of the whole local database (one "device"). */
export async function saveDevice(): Promise<DeviceImage> {
  const out: DeviceImage = {};
  for (const t of db.tables) out[t.name] = await t.toArray();
  return out;
}

/** Replace the local database with a device snapshot. */
export async function loadDevice(img: DeviceImage): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    for (const t of db.tables) {
      await t.clear();
      const rows = img[t.name] ?? [];
      if (rows.length) await t.bulkPut(rows);
    }
  });
}

/** Run fn with `img` loaded as the local database and return the updated image. */
export async function onDevice(img: DeviceImage, fn: () => Promise<void>): Promise<DeviceImage> {
  await loadDevice(img);
  await fn();
  return saveDevice();
}
