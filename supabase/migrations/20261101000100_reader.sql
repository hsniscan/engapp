-- Engapp v0.5 İP1: the reader (docs/decisions/0043-reader.md).
--
-- user_texts: the user's reading texts (pasted, PDF, article, photo, subtitle, a graded
-- library text's reading state, the daily story), the app's Dexie table `texts`. Mutable,
-- last-writer-wins by hlc, deletion is a tombstone (purged after 30 days).
-- user_encounters: how often the user met each of their words per day, source and device
-- (the encounter counter), the app's Dexie table `encounters`. Mutable like user_texts; one
-- row per device so two devices never overwrite each other's counts. Never FSRS input.
--
-- Both are one account's private data: RLS on auth.uid(), never readable by anyone else,
-- never copied to another account by the client (decision 0009), and never written into a
-- shared table (lexicon_*, ai_chunk_cache, graded_texts; AGENTS.md rule 5). Deleting the
-- account removes them (foreign key ON DELETE CASCADE, delete_user_data()).
--
-- The client names the tables `texts` / `encounters` and maps the names at the wire
-- (src/sync/api.ts). Both join the sync registry, so sync_push / sync_pull_v3 /
-- purge_tombstones handle them with no new functions; sync_pull / sync_pull_v2 (v0.1
-- clients) never return them. A client pushes their rows only after it has seen them listed
-- in public.sync_tables (LATE_SYNC_TABLES).
--
-- settings gains the reading difficulty, the "çok zor / çok kolay" correction and the word
-- colour switch. Nullable, no default: an older client upserts settings without the keys
-- (jsonb_populate_record gives null) and a push that leaves a key out keeps the stored value.
--
-- Checks are loose on purpose (a rejected row would wait in the outbox forever): they bound
-- sizes and enumerations only.

-- ---------------------------------------------------------------------------
-- user_texts
-- ---------------------------------------------------------------------------

create table public.user_texts (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('paste', 'pdf', 'article', 'ocr', 'subtitle', 'graded', 'story')),
  title text not null check (char_length(title) <= 300),
  -- Plain text, paragraphs separated by a blank line (MAX_TEXT_CHARS on the client).
  body text not null check (char_length(body) <= 300000),
  source_url text check (char_length(source_url) <= 2000),
  graded_id text check (char_length(graded_id) <= 200),
  progress_offset integer not null default 0 check (progress_offset >= 0),
  read_ms bigint not null default 0 check (read_ms >= 0),
  finished_at bigint check (finished_at >= 0),
  feedback text check (feedback is null or feedback in ('hard', 'easy')),
  created_at bigint not null check (created_at >= 0),
  updated_at bigint not null check (updated_at >= 0),
  deleted_at bigint check (deleted_at >= 0),
  hlc text not null check (public.is_hlc(hlc)),
  server_seq bigint not null default 0,
  server_updated_at timestamptz not null default now()
);

create index user_texts_user_seq on public.user_texts (user_id, server_seq);
create index user_texts_purge on public.user_texts (server_updated_at) where deleted_at is not null;

create trigger stamp_sync_row before insert or update on public.user_texts
  for each row execute function public.tg_stamp_sync_row();

alter table public.user_texts enable row level security;
revoke all on table public.user_texts from anon, authenticated;
create policy "own rows: select" on public.user_texts for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own rows: insert" on public.user_texts for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "own rows: update" on public.user_texts for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- No DELETE: deletion is a tombstone, purged by public.purge_tombstones().
grant select, insert, update on table public.user_texts to authenticated;

comment on table public.user_texts is
  'v0.5: the user''s reading texts (private; never copied to another account or a shared table).';

-- ---------------------------------------------------------------------------
-- user_encounters
-- ---------------------------------------------------------------------------

create table public.user_encounters (
  -- "<note_id>|<YYYY-MM-DD>|<source>|<device_id>" (domain/texts.ts encounterId).
  id text not null check (char_length(id) between 1 and 200),
  user_id uuid not null references auth.users (id) on delete cascade,
  note_id uuid not null,
  day text not null check (day ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  source text not null check (source in ('review', 'reader', 'story')),
  n integer not null check (n >= 0),
  device_id text not null check (char_length(device_id) between 1 and 100),
  created_at bigint not null check (created_at >= 0),
  updated_at bigint not null check (updated_at >= 0),
  deleted_at bigint check (deleted_at >= 0),
  hlc text not null check (public.is_hlc(hlc)),
  server_seq bigint not null default 0,
  server_updated_at timestamptz not null default now(),
  -- The id is derived, not random: keyed per user like settings, so one user's ids can never
  -- meet another user's row.
  primary key (user_id, id)
);

create index user_encounters_user_seq on public.user_encounters (user_id, server_seq);
create index user_encounters_purge on public.user_encounters (server_updated_at) where deleted_at is not null;

create trigger stamp_sync_row before insert or update on public.user_encounters
  for each row execute function public.tg_stamp_sync_row();

alter table public.user_encounters enable row level security;
revoke all on table public.user_encounters from anon, authenticated;
create policy "own rows: select" on public.user_encounters for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own rows: insert" on public.user_encounters for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "own rows: update" on public.user_encounters for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update on table public.user_encounters to authenticated;

comment on table public.user_encounters is
  'v0.5: times the user met each word per day, source and device (private; never FSRS input).';

-- ---------------------------------------------------------------------------
-- settings: reading
-- ---------------------------------------------------------------------------

alter table public.settings
  add column reading_difficulty text
    check (reading_difficulty is null or reading_difficulty in ('rahat', 'dengeli', 'zorlayici')),
  add column reading_offset double precision
    check (reading_offset is null or reading_offset between -0.5 and 0.5),
  add column reader_highlight boolean;

comment on column public.settings.reading_difficulty is
  'v0.5: reading difficulty (rahat 2-3 %, dengeli 3-5 %, zorlayici 6-10 % unknown words); null = dengeli.';
comment on column public.settings.reading_offset is
  'v0.5: the "cok zor / cok kolay" correction of estimated unknown words (-0.5..0.5); null = 0.';
comment on column public.settings.reader_highlight is
  'v0.5: the reader colours words by stage; null = on.';

-- ---------------------------------------------------------------------------
-- registry
-- ---------------------------------------------------------------------------

insert into public.sync_tables (name, insert_only, conflict_key) values
  ('user_texts', false, '(id)'),
  ('user_encounters', false, '(user_id, id)');
