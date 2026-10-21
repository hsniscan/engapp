-- Engapp v0.2 İP3: level tests, known words and the user's level (docs/decisions/0017).
--
-- level_tests: one row per finished level test. Insert-only like review_logs (a test is
-- history; it is never changed).
-- known_terms: words the user knows without a card ("Biliyorum" in the test, in an import
-- preview or by hand). Mutable; removing a word is a tombstone (purged after 30 days).
-- Both are study history of one account: the client never copies them to another account
-- (decision 0009), and they never reach the shared lexicon.
--
-- settings: level_source / level_updated_at / level_locked / level_change. _sync_upsert
-- updates only the columns a payload carries, so an older app version that pushes its
-- settings row without them keeps these values.
--
-- Both tables join the sync registry: sync_push and sync_pull_v3 handle them with no new
-- functions; sync_pull / sync_pull_v2 keep returning only the six v0.1 tables. A client
-- pushes rows of these tables only after it has seen them listed in public.sync_tables.

-- ---------------------------------------------------------------------------
-- level_tests
-- ---------------------------------------------------------------------------
-- Checks are loose on purpose (as on practice_logs): a rejected row would wait in the
-- outbox forever.

create table public.level_tests (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  taken_at bigint not null check (taken_at >= 0),
  result_level text not null check (result_level in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
  vocab_estimate integer not null check (vocab_estimate >= 0),
  reliable boolean not null,
  false_alarm_rate double precision not null check (false_alarm_rate between 0 and 1),
  -- {"A1": 0.98, ..., "C2": 0.05}: corrected share of known words per level.
  ratios jsonb not null check (jsonb_typeof(ratios) = 'object'),
  -- [{w, band, pseudo, answer, mc_ok?}]
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 200),
  bank_version text not null check (char_length(bank_version) between 1 and 64),
  applied boolean not null,
  duration_ms integer not null check (duration_ms >= 0),
  device_id text not null check (char_length(device_id) <= 100),
  created_at bigint not null check (created_at >= 0),
  hlc text not null check (public.is_hlc(hlc)),
  server_seq bigint not null default 0,
  server_updated_at timestamptz not null default now()
);

create index level_tests_user_seq on public.level_tests (user_id, server_seq);

create trigger stamp_sync_row before insert or update on public.level_tests
  for each row execute function public.tg_stamp_sync_row();

alter table public.level_tests enable row level security;
revoke all on table public.level_tests from anon, authenticated;
create policy "own rows: select" on public.level_tests for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own rows: insert" on public.level_tests for insert to authenticated
  with check (user_id = (select auth.uid()));
-- INSERT + SELECT only: no update/delete policy and no grant.
grant select, insert on table public.level_tests to authenticated;

-- ---------------------------------------------------------------------------
-- known_terms
-- ---------------------------------------------------------------------------

create table public.known_terms (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Normalised dictionary form, the same key as notes.term_norm.
  term_norm text not null check (char_length(term_norm) between 1 and 200),
  source text not null check (source in ('test', 'preview', 'manual', 'auto')),
  cefr_at_mark text check (cefr_at_mark in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
  created_at bigint not null check (created_at >= 0),
  updated_at bigint not null check (updated_at >= 0),
  deleted_at bigint check (deleted_at >= 0),
  hlc text not null check (public.is_hlc(hlc)),
  server_seq bigint not null default 0,
  server_updated_at timestamptz not null default now()
);

create index known_terms_user_seq on public.known_terms (user_id, server_seq);

create trigger stamp_sync_row before insert or update on public.known_terms
  for each row execute function public.tg_stamp_sync_row();

alter table public.known_terms enable row level security;
revoke all on table public.known_terms from anon, authenticated;
create policy "own rows: select" on public.known_terms for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own rows: insert" on public.known_terms for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "own rows: update" on public.known_terms for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- Hard DELETE is not granted: deletion is a tombstone, purged by purge_tombstones().
grant select, insert, update on table public.known_terms to authenticated;

-- ---------------------------------------------------------------------------
-- settings: the user's level
-- ---------------------------------------------------------------------------

alter table public.settings
  add column level_source text not null default 'default'
    check (level_source in ('default', 'test', 'auto', 'manual')),
  add column level_updated_at bigint check (level_updated_at >= 0),
  add column level_locked boolean not null default false,
  -- The weekly update's last change and its reason ({from, to, week, band, ratio, ...}).
  add column level_change jsonb check (level_change is null or jsonb_typeof(level_change) = 'object');

-- sync_push inserts a row through jsonb_populate_record, so a key the payload lacks (an older
-- app version creating its settings row) arrives as null, not as the column default.
create or replace function public.tg_settings_level_defaults()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.level_source := coalesce(new.level_source, 'default');
  new.level_locked := coalesce(new.level_locked, false);
  return new;
end;
$$;

revoke all on function public.tg_settings_level_defaults() from public, anon, authenticated;

create trigger settings_level_defaults before insert or update on public.settings
  for each row execute function public.tg_settings_level_defaults();

-- ---------------------------------------------------------------------------
-- registry
-- ---------------------------------------------------------------------------

insert into public.sync_tables (name, insert_only, conflict_key) values
  ('level_tests', true, '(id)'),
  ('known_terms', false, '(id)');
