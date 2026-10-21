# 0006 — Backend: sync via Postgres RPC; AI pipeline details

**Context.** The plan names `sync_push` / `sync_pull` "server functions" and describes
the AI pipeline in outline. Implementation choices that differ from or sharpen it:

**Decisions.**

1. Sync push/pull are Postgres functions (`SECURITY INVOKER`, called with
   `supabase.rpc`), not edge functions: RLS applies to every row, a batch is one
   transaction, no service key, one hop fewer. `user_id` is always `auth.uid()`.
2. `server_seq` comes from one global sequence; a per-user advisory lock in the stamping
   trigger keeps commit order equal to sequence order, so cursors never skip rows.
3. `full_resync` is sent when the cursor is below the user's highest _purged_ tombstone
   (`sync_horizon`), not merely when it is 30 days old: same safety, fewer full resyncs.
   The purge clock is server time (`server_updated_at`), not the client's `deleted_at`.
4. No server-side `UNIQUE (user_id, term_norm)` / `(note_id, lexicon_sense_id)`:
   offline duplicates must not block the outbox; the client marks `possible_duplicate`.
5. The server chunk cache is per user and keyed by `(chunk_hash, prompt_version, level)`;
   a shared cache would let anyone test whether a text was imported by someone else.
6. Character spans are computed by the server from `surface` (models miscount); the
   sentence must still occur verbatim in the chunk.
7. Gemini's 503 UNAVAILABLE ("high demand") is treated like a quota error: retry, then the
   fallback model. Schemas carry no `maxItems` (Gemini rejects it with HTTP 400).
8. Edge functions run with `verify_jwt = false` and verify the token themselves with
   `supabase.auth.getClaims` (works with the project's asymmetric signing keys and
   the new publishable/secret API keys).

**Why.** Safety (RLS, no lost rows, no lost reviews), privacy, and cost (fewer model calls).
