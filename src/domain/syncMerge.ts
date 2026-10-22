// Merge rule for a pulled row whose HLC equals the local row's (the same write).
//
// An app version that does not know a column drops it when it pulls a row (zod strips unknown
// keys); after the update, the Dexie upgrade fills the column with its "unset" value (notes
// level_override = null, settings level_source = 'default' / 'manual', level_locked = false…).
// The local row then has the same HLC as the server's but lacks what another device stored
// there. Last-writer-wins skips an equal HLC, so the device would keep the unset value and its
// next edit would push it over the real one (a level the user set, a locked level). Pushes of
// an older app version leave the column out, and the server keeps it (_sync_upsert, İP2), so
// the echo of such a push has the same problem.
//
// Same HLC = same write, so the server's copy can only know more: take its value for these
// columns when it is set (not the unset value) and the local one differs. An unset server
// value never overwrites a local one (a backend from before the column's migration answers
// without it, and the pull schema fills the default).

/** Columns added after v0.1 per table, with their unset value. */
const LATE_COLUMNS: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  notes: { level_override: null },
  sources: { topics: null },
  settings: {
    interests: null,
    muted_topics: null,
    example_tr_visible: null,
    example_contexts: null,
    level_source: 'default',
    level_updated_at: null,
    level_locked: false,
    level_change: null,
    show_easy_candidates: null,
    // v0.3 İP3. catchup_auto defaults to true, so its "unset" is only a missing key or null
    // (undefined here: a stored false is a real choice and must be taken).
    daily_capacity_min: null,
    catchup_auto: undefined,
    vacation: null,
    vacation_history: null,
    fsrs_params_prev: null,
    fsrs_opt_at: null,
  },
};

function isUnset(value: unknown, unset: unknown): boolean {
  return (
    value === undefined || value === null || value === unset || (unset === null && value === false)
  );
}

function same(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/**
 * `local` with the late columns `remote` (same HLC) has set and `local` lacks or holds
 * differently. Returns `local` itself when there is nothing to take.
 */
export function fillLateColumns<T extends object>(table: string, remote: object, local: T): T {
  const cols = LATE_COLUMNS[table];
  if (!cols) return local;
  let out = local;
  for (const [col, unset] of Object.entries(cols)) {
    const theirs = (remote as Record<string, unknown>)[col];
    if (isUnset(theirs, unset)) continue;
    if (same(theirs, (local as Record<string, unknown>)[col])) continue;
    out = { ...out, [col]: theirs };
  }
  return out;
}
