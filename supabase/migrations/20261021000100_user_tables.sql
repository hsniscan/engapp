-- Engapp: per-user synced tables, server sequence, RLS.
--
-- Column names and types mirror src/domain/types.ts so rows sync without mapping:
-- client timestamps are UTC epoch milliseconds (bigint), ids are client-generated UUID v7.
-- Server-only columns: server_seq (sync cursor) and server_updated_at (purge clock).
-- They are set by trigger on every insert/update and stripped from sync_pull output.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.now_ms()
returns bigint
language sql
volatile
set search_path = ''
as $$
  select (extract(epoch from clock_timestamp()) * 1000)::bigint
$$;

-- One global sequence for all user tables: a single cursor orders rows across tables.
create sequence if not exists public.sync_seq as bigint;

-- Stamps server_seq / server_updated_at and serialises writers per user.
--
-- Why the advisory lock: sequence values are handed out at write time, not at commit
-- time. Without serialisation a transaction holding seq 10 could commit after one
-- holding seq 11; a pull in between would advance the cursor past 10 and miss it.
-- A per-user transaction lock makes a user's writing transactions commit in seq order,
-- so "server_seq > cursor" never skips a row. Pulls only ever read one user's rows,
-- so a per-user lock is enough. The lock is released at commit/rollback.
create or replace function public.tg_stamp_sync_row()
returns trigger
language plpgsql
security definer -- nextval on public.sync_seq without granting the sequence to clients
set search_path = ''
as $$
begin
  if new.user_id is null then
    raise exception 'user_id is required' using errcode = '23502';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('engapp.sync:' || new.user_id::text, 0));
  new.server_seq := pg_catalog.nextval('public.sync_seq');
  new.server_updated_at := pg_catalog.now();
  return new;
end;
$$;

-- HLC strings are fixed width ("<15-digit ms>:<5-digit counter>:<node>", see
-- src/domain/hlc.ts), so byte-wise comparison (COLLATE "C") orders them.
create or replace function public.is_hlc(v text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select v ~ '^[0-9]{15}:[0-9]{5}:[A-Za-z0-9_-]{0,64}$'
$$;

-- ---------------------------------------------------------------------------
-- profiles (one row per auth user, created by trigger; not part of the sync batches)
-- ---------------------------------------------------------------------------

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 200),
  avatar_url text check (char_length(avatar_url) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, display_name, avatar_url)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), 200),
    left(new.raw_user_meta_data ->> 'avatar_url', 2000)
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- notes
-- ---------------------------------------------------------------------------
-- No unique (user_id, term_norm) on the server: two offline devices can create the same
-- term; the second push must not be rejected forever. The client marks such pairs as
-- possible_duplicate (see docs/sync-strategy.md).

create table public.notes (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  term text not null check (char_length(term) between 1 and 200),
  term_norm text not null check (char_length(term_norm) between 1 and 200),
  term_type text not null check (term_type in ('word', 'phrase', 'pattern')),
  lexicon_term_id uuid,
  ipa text check (char_length(ipa) <= 200),
  tags text[] not null default '{}' check (cardinality(tags) <= 50),
  possible_duplicate boolean not null default false,
  created_at bigint not null check (created_at >= 0),
  updated_at bigint not null check (updated_at >= 0),
  deleted_at bigint check (deleted_at >= 0),
  hlc text not null check (public.is_hlc(hlc)),
  server_seq bigint not null default 0,
  server_updated_at timestamptz not null default now()
);

create index notes_user_seq on public.notes (user_id, server_seq);
create index notes_user_term on public.notes (user_id, term_norm);
create index notes_purge on public.notes (server_updated_at) where deleted_at is not null;

-- ---------------------------------------------------------------------------
-- senses
-- ---------------------------------------------------------------------------
-- No foreign key to notes: rows may arrive in any order across push batches, and a
-- tombstoned note can be purged while a sense tombstone still waits. Integrity is
-- checked on the client (integrity check / repair).

create table public.senses (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  note_id uuid not null,
  sense_no integer not null check (sense_no between 0 and 1000),
  lexicon_sense_id uuid,
  pos text check (char_length(pos) <= 40),
  gloss_en text check (char_length(gloss_en) <= 300),
  meaning_tr text not null check (char_length(meaning_tr) <= 500),
  meaning_tr_override text check (char_length(meaning_tr_override) <= 500),
  source_sentence text check (char_length(source_sentence) <= 2000),
  span integer[] check (
    span is null
    or (array_ndims(span) = 1 and cardinality(span) = 2 and span[1] >= 0 and span[2] >= span[1])
  ),
  source_id uuid,
  created_at bigint not null check (created_at >= 0),
  updated_at bigint not null check (updated_at >= 0),
  deleted_at bigint check (deleted_at >= 0),
  hlc text not null check (public.is_hlc(hlc)),
  server_seq bigint not null default 0,
  server_updated_at timestamptz not null default now()
);

create index senses_user_seq on public.senses (user_id, server_seq);
create index senses_note on public.senses (note_id);
create index senses_user_lexicon on public.senses (user_id, lexicon_sense_id) where lexicon_sense_id is not null;
create index senses_purge on public.senses (server_updated_at) where deleted_at is not null;

-- ---------------------------------------------------------------------------
-- cards
-- ---------------------------------------------------------------------------

create table public.cards (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  note_id uuid not null,
  sense_id uuid,
  card_type text not null check (card_type in ('recognition', 'production', 'cloze')),
  due bigint not null,
  stability double precision not null,
  difficulty double precision not null,
  elapsed_days double precision not null default 0,
  scheduled_days double precision not null default 0,
  learning_steps integer not null default 0,
  reps integer not null default 0 check (reps >= 0),
  lapses integer not null default 0 check (lapses >= 0),
  state smallint not null check (state between 0 and 3),
  last_review bigint,
  suspended boolean not null default false,
  unlocked boolean not null default false,
  created_at bigint not null check (created_at >= 0),
  updated_at bigint not null check (updated_at >= 0),
  deleted_at bigint check (deleted_at >= 0),
  hlc text not null check (public.is_hlc(hlc)),
  server_seq bigint not null default 0,
  server_updated_at timestamptz not null default now()
);

create index cards_user_seq on public.cards (user_id, server_seq);
create index cards_note on public.cards (note_id);
create index cards_purge on public.cards (server_updated_at) where deleted_at is not null;

-- ---------------------------------------------------------------------------
-- review_logs (append-only)
-- ---------------------------------------------------------------------------
-- Checks are deliberately loose: a rejected log would be stuck in the outbox forever,
-- and losing a review is worse than storing an odd duration.

create table public.review_logs (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  card_id uuid not null,
  rating smallint not null check (rating between 1 and 4),
  reviewed_at bigint not null check (reviewed_at >= 0),
  duration_ms integer not null check (duration_ms >= 0),
  device_id text not null check (char_length(device_id) <= 100),
  undo_of uuid,
  shown_sense_id uuid,
  created_at bigint not null check (created_at >= 0),
  hlc text not null check (public.is_hlc(hlc)),
  server_seq bigint not null default 0,
  server_updated_at timestamptz not null default now()
);

create index review_logs_user_seq on public.review_logs (user_id, server_seq);
create index review_logs_card on public.review_logs (card_id);

-- ---------------------------------------------------------------------------
-- sources (metadata only; the imported text itself never leaves the device)
-- ---------------------------------------------------------------------------

create table public.sources (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('text', 'pdf')),
  title text not null check (char_length(title) <= 500),
  file_name text check (char_length(file_name) <= 500),
  page_count integer check (page_count >= 0),
  created_at bigint not null check (created_at >= 0),
  updated_at bigint not null check (updated_at >= 0),
  deleted_at bigint check (deleted_at >= 0),
  hlc text not null check (public.is_hlc(hlc)),
  server_seq bigint not null default 0,
  server_updated_at timestamptz not null default now()
);

create index sources_user_seq on public.sources (user_id, server_seq);
create index sources_purge on public.sources (server_updated_at) where deleted_at is not null;

-- ---------------------------------------------------------------------------
-- settings (one row per user, id = 'settings')
-- ---------------------------------------------------------------------------

create table public.settings (
  id text not null check (char_length(id) between 1 and 64),
  user_id uuid not null references auth.users (id) on delete cascade,
  daily_new_limit integer not null check (daily_new_limit between 0 and 10000),
  request_retention double precision not null check (request_retention > 0 and request_retention < 1),
  timezone text not null check (char_length(timezone) <= 64),
  day_start_hour integer not null check (day_start_hour between 0 and 23),
  theme text not null check (theme in ('system', 'light', 'dark')),
  voice text not null check (char_length(voice) <= 32),
  level text not null check (level in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
  fsrs_params double precision[] check (fsrs_params is null or cardinality(fsrs_params) <= 64),
  last_backup_at bigint,
  created_at bigint not null check (created_at >= 0),
  updated_at bigint not null check (updated_at >= 0),
  deleted_at bigint check (deleted_at >= 0),
  hlc text not null check (public.is_hlc(hlc)),
  server_seq bigint not null default 0,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index settings_user_seq on public.settings (user_id, server_seq);

-- ---------------------------------------------------------------------------
-- Triggers, RLS, grants
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['notes', 'senses', 'cards', 'review_logs', 'sources', 'settings'] loop
    execute format(
      'create trigger stamp_sync_row before insert or update on public.%I
         for each row execute function public.tg_stamp_sync_row()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format(
      'create policy "own rows: select" on public.%I for select to authenticated
         using (user_id = (select auth.uid()))', t);
    execute format(
      'create policy "own rows: insert" on public.%I for insert to authenticated
         with check (user_id = (select auth.uid()))', t);
  end loop;

  -- Mutable tables: update own rows. Hard DELETE is not granted to clients at all:
  -- deletion is a tombstone (deleted_at), purged by public.purge_tombstones().
  foreach t in array array['notes', 'senses', 'cards', 'sources', 'settings'] loop
    execute format(
      'create policy "own rows: update" on public.%I for update to authenticated
         using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('grant select, insert, update on table public.%I to authenticated', t);
  end loop;

  -- review_logs: INSERT + SELECT only. No update/delete policy and no grant.
  grant select, insert on table public.review_logs to authenticated;
end;
$$;

alter table public.profiles enable row level security;
revoke all on table public.profiles from anon, authenticated;
grant select, update (display_name, avatar_url, updated_at) on table public.profiles to authenticated;
create policy "own profile: select" on public.profiles for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own profile: update" on public.profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on sequence public.sync_seq from public, anon, authenticated;
revoke all on function public.tg_stamp_sync_row() from public, anon, authenticated;
