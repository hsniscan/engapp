# Sync strategy

The device's IndexedDB (Dexie) is the source of truth; the server is a backup and a
bridge between devices. The UI never waits for the server. This file describes the
server contract (implemented) and the rules the sync engine must follow (the engine
itself lives in `src/sync/` and is built on `src/sync/api.ts`).

Sign-in is Google only. Guests sync nothing; on first sign-in all local rows get the
user's id and go through the outbox.
Data that belongs to another account is never re-stamped: the device offers to copy its
cards without study history, or to start with the signed-in account's data (decision 0008).

## Transport: Postgres RPC, not edge functions

`sync_push`, `sync_pull`, `lexicon_pull` and `lexicon_get` are SQL functions in
`supabase/migrations/20261021000400_sync.sql`, called with `supabase.rpc()`. They run
`SECURITY INVOKER` as the signed-in user, so every read and write passes the same RLS
policies as direct table access; a push batch is one transaction; no service key is
involved; there is no extra hop through an edge function. `user_id` is never taken
from the client: `sync_push` overwrites it with `auth.uid()`.

Client wrappers: `pushBatch`, `pullChanges`, `pullLexicon`, `getLexiconSenses` in
`src/sync/api.ts` (pulled rows are validated with `src/domain/schemas.ts`).

## Server tables

`notes`, `senses`, `cards`, `review_logs`, `sources`, `settings` and (v0.2)
`practice_logs` mirror `src/domain/types.ts` column for column (timestamps are epoch ms `bigint`). Extra
server-only columns, removed from pull output:

- `server_seq bigint`: from one global sequence `sync_seq`, set by a trigger on every
  insert and update. A per-user transaction advisory lock in that trigger makes a
  user's writing transactions commit in `server_seq` order, so `server_seq > cursor`
  never skips a row that commits late.
- `server_updated_at timestamptz`: server time of the last write (purge clock).

Keys: `id` (UUID v7 from the client); `settings` uses `(user_id, id)` because every
user's row has `id = 'settings'`.

Deliberately not enforced on the server:

- `UNIQUE (user_id, term_norm)` on notes and `UNIQUE (note_id, lexicon_sense_id)` on
  senses: two offline devices can create the same term; a server unique constraint
  would reject the second push forever. The client merges and marks
  `possible_duplicate` (plan, "Hesap"). **The Dexie schema's `&term_norm` unique index
  will reject such a pulled row; the engine must handle that case** (e.g. keep both,
  set `possible_duplicate`, or relax the index).
- Foreign keys between synced tables: rows arrive in any order across batches, and
  tombstones are purged independently. Integrity is the client's integrity check.

RLS on every table: `user_id = auth.uid()` for select/insert/update. No client has
DELETE (deletion is a tombstone). `review_logs` and `practice_logs`: SELECT and INSERT only.

### Table registry (v0.2)

`public.sync_tables(name, insert_only, conflict_key)` lists the synced user tables
(migration `20261021000900_practice.sql`). `sync_push`, `_sync_upsert`, `sync_pull_v3` and
`purge_tombstones` build their statements from it with `format('%I')`, so the registry is
also the whitelist of table names. A later package adds a synced table by creating it (with
the stamp trigger and the standard RLS) and inserting one registry row. Clients can read the
registry but cannot write it. pgTAP checks that every registered table has RLS with
select and insert policies, that mutable tables have an update policy, and that insert-only
tables can be neither updated nor deleted.

### Columns older clients do not know (v0.2 İP7)

A client that predates a column pushes rows without it, and `jsonb_populate_record` makes it
null, so normally its edit clears the column (accepted for `senses.source_sentence_tr`). For
`settings.interests`, `settings.muted_topics` and `sources.topics` a `keep_profile_fields`
BEFORE UPDATE trigger keeps the stored value when the incoming one is null, and
`applyRemoteRows` does the same locally (`keepProfileFields`). A list is cleared with `[]`,
never with null (decision 0015).

## Push

`sync_push(p_batch jsonb)`; `p_batch` = up to 100 items `{table, op, payload}`:

| op                        | payload                                                              | server                                                                                                       |
| ------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `upsert`                  | the full row                                                         | insert; on conflict update **only if** `excluded.hlc > current.hlc` (byte-wise, HLC strings are fixed width) |
| `delete`                  | the full row with `deleted_at`, or at least `{id, hlc, deleted_at?}` | tombstone with the same last-writer-wins rule; a missing row is acked (nothing to delete)                    |
| `upsert` on `review_logs` | the full row                                                         | `INSERT … ON CONFLICT (id) DO NOTHING` (append-only, idempotent)                                             |
| `delete` on `review_logs` | —                                                                    | rejected                                                                                                     |

`practice_logs` (and any other `insert_only` table in the registry) behaves like
`review_logs`.

Response: `{acked: [id], stale: [id], rejected: [{table, id, code, message}]}`

- `acked`: the server has this change or a newer one. Delete these outbox rows.
- `stale` ⊆ `acked`: lost last-writer-wins; the newer row comes with the next pull.
- `rejected`: invalid row (type/constraint error, bad HLC, unknown table, or an id that
  belongs to another user: SQLSTATE `42501`). Keep it, `attempts++`, back off; warn
  after 10 attempts. Every item runs in its own subtransaction, so one bad row does
  not fail the batch.

Whole-call errors: not signed in (`42501` → `SyncApiError('not_signed_in')`), more than
100 items (`22023`), network (`SyncApiError('network')`).

Payload columns the server does not know are ignored; server columns
(`server_seq`, `server_updated_at`, `user_id`) are overwritten. Missing NOT NULL columns
reject the row (send full rows).

## Pull

`sync_pull(p_since bigint, p_limit int ≤ 500)` →
`{rows: [{table, seq, row}], next_seq, has_more, full_resync}`.

The client calls `sync_pull_v2(p_since, p_limit, p_from)` (migration
`20261021000600_sync_pull_from.sql`; same page, `sync_pull` stays for older clients and is
the fallback when v2 is not deployed yet). `p_from` is the cursor the current run of pages
started at, 0 for a full pull. The horizon check uses `p_from`: with `sync_pull`, page 2 of
any pull that started at 0 answered `full_resync` once a tombstone above page 1 had been
purged, so a new device or a full resync could never get past its first page.

- Rows of all six tables with `server_seq > p_since`, merged in `server_seq` order.
- Store `next_seq` as `meta.sync_cursor` **in the same Dexie transaction** as the rows;
  a repeated pull then gives the same result. Repeat while `has_more`.
- Incoming row vs local: if a local outbox entry for the row has a higher HLC, keep the
  local row; otherwise overwrite. Merge the remote HLC into the local clock (`receive`).
- New `review_logs` for a card → recompute that card from all its logs.

**v3 (v0.2).** The client tries `sync_pull_v3(p_since, p_limit, p_from)` first. It has the
same envelope and horizon rule as v2, but returns every table in the registry, so it
includes `practice_logs`. If it is missing (`PGRST202`/`42883`), the client uses v2, then
`sync_pull`. `sync_pull` and `sync_pull_v2` are unchanged and keep returning the six v0.1
tables, so a v0.1 client never sees a table it does not know.

`PullResult.version` says which function answered. The engine stores
`meta.server_practice_logs = (version === 3)`. Until it is true, `practice_logs` outbox rows
are skipped by push. This way a new client against a backend without the migration does
not burn attempts on rows the server would reject, and the order of deploys does not
matter. Practice logs are inserted if new and never trigger a recompute. A full resync does
not delete local insert-only rows that the pull did not return.

Known gap: a v0.1 client pulls with v2 and moves its cursor past practice rows written by
another device. After it updates, it does not get them (decision 0010).

### Tombstones and full resync

`purge_tombstones(30)` (daily at 03:17 UTC via pg_cron) deletes tombstones whose
`server_updated_at` is older than 30 days and records, per user, the highest purged
`server_seq` in `sync_horizon.purged_through_seq`. `sync_pull` answers
`full_resync: true` (no rows) when `0 < p_from < purged_through_seq` (`sync_pull`:
`p_since`), i.e. exactly when the device could have missed a deletion; a device that was offline for 31 days but whose
deletions were not purged yet just pulls normally. On `full_resync`: push the outbox,
then pull from 0 and delete local synced rows (not in the outbox) that the full pull
did not return.

## Lexicon

The shared dictionary is never pushed. `lexicon_pull(p_since, p_limit)` returns the
`LexiconSense` rows referenced by the user's senses whose lexicon `server_seq` (its own
sequence `lexicon_seq`) is above `meta.lexicon_cursor`; this brings corrections. A
sense older than the cursor that becomes referenced later (e.g. a note synced from
another device) is not in that feed: after a pull, look for `lexicon_sense_id`s missing
from `lexicon_cache` and fetch them with `lexicon_get(ids)` (≤ 500). `meaning_tr_override`
on the user's sense always wins over the lexicon.

## Edge cases (plan table) and where they are handled

| Case                                      | Handling                                                                      |
| ----------------------------------------- | ----------------------------------------------------------------------------- |
| Same batch sent twice                     | upserts with equal HLC are `stale` no-ops; review logs `DO NOTHING`           |
| Connection drops mid-push                 | the transaction rolls back or commits fully; un-acked rows stay in the outbox |
| Two devices edit the same row             | higher HLC wins on the server and on each client                              |
| One device deletes, another edits         | tombstone vs edit: higher HLC wins (a later edit undeletes)                   |
| Both devices review the same card offline | both logs kept; card recomputed from logs                                     |
| Device offline > 30 days                  | `full_resync` only if tombstones past its cursor were purged                  |
| Wrong device clock                        | ordering uses `server_seq`; purge uses server time; HLC keeps causality       |
| Account deleted                           | `ON DELETE CASCADE` from `auth.users` on every user table                     |

## Tests

- `supabase/tests/database/*.test.sql` (pgTAP, `supabase test db`): RLS on every table,
  cross-user read/write denial, push validation/idempotency/LWW/tombstones, review log
  immutability, pagination, purge → `full_resync`. `05_practice_logs.test.sql`: the
  registry, insert-only practice logs, v3 pull pages and horizon, and v1/v2 not returning
  them.
- `src/sync/practice.test.ts` (FakeServer): practice logs wait for a v3 server, then sync
  insert-only between devices without touching cards.
- `supabase/tests/integration/stack.test.ts`: the same through PostgREST with
  `src/sync/api.ts`.
- `src/sync/api.test.ts`: response validation and error classification.
