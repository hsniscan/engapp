// Whole-table reads with a JavaScript predicate (decision 0053).
//
// `db.table.filter(fn).toArray()` / `.count()` make Dexie walk an IndexedDB cursor: one round
// trip to the database per row. On a 10,000-card profile that took seconds per query on the
// home screen. Reading the table with one getAll and filtering in memory gives the same rows
// in the same (primary-key) order, in a fraction of the time. Use these instead; keep Dexie's
// `.filter().first()` where stopping early matters.

/** A Dexie Table (its row type is read from `filter`, which has a single signature). */
interface Readable<T> {
  filter(fn: (row: T) => boolean): unknown;
  toArray(): Promise<T[]>;
}

// Plain functions that chain on Dexie's own promise (no `async`): inside a transaction the
// result stays a Dexie promise, so awaiting it keeps the transaction's zone.
export function scanWhere<T>(table: Readable<T>, pred: (row: T) => boolean): Promise<T[]> {
  return table.toArray().then((rows) => rows.filter(pred));
}

export function scanCount<T>(table: Readable<T>, pred: (row: T) => boolean): Promise<number> {
  return table.toArray().then((rows) => {
    let n = 0;
    for (const row of rows) if (pred(row)) n++;
    return n;
  });
}
