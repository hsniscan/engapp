-- Engapp v0.2 İP8: smart decks ("Akıllı desteler").
--
-- A deck is a named, saved filter over the user's notes; the filter is evaluated on the
-- device (src/domain/deckFilter.ts). The server stores it as opaque JSON: its schema is
-- versioned inside the object ({"v": 1, ...}) so newer clients can add keys without a
-- migration. Only size and shape are checked here, loosely on purpose (a rejected row would
-- wait in the outbox forever).
--
-- Registered in public.sync_tables, so sync_push / sync_pull_v3 / purge_tombstones handle it
-- with no new functions. sync_pull and sync_pull_v2 (v0.1 clients) never return it.
-- Tags stay in notes.tags (text[], since v0.1); theme groups (ai-themes) become tags and
-- need no table. Nothing here is shared between users.

create table public.decks (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  filter jsonb not null default '{}'::jsonb
    check (jsonb_typeof(filter) = 'object' and pg_column_size(filter) <= 8192),
  sort integer not null default 0,
  created_at bigint not null check (created_at >= 0),
  updated_at bigint not null check (updated_at >= 0),
  deleted_at bigint check (deleted_at >= 0),
  hlc text not null check (public.is_hlc(hlc)),
  server_seq bigint not null default 0,
  server_updated_at timestamptz not null default now()
);

create index decks_user_seq on public.decks (user_id, server_seq);
create index decks_purge on public.decks (server_updated_at) where deleted_at is not null;

create trigger stamp_sync_row before insert or update on public.decks
  for each row execute function public.tg_stamp_sync_row();

alter table public.decks enable row level security;
revoke all on table public.decks from anon, authenticated;
create policy "own rows: select" on public.decks for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own rows: insert" on public.decks for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "own rows: update" on public.decks for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- No DELETE: deletion is a tombstone, purged by public.purge_tombstones().
grant select, insert, update on table public.decks to authenticated;

insert into public.sync_tables (name, insert_only, conflict_key) values ('decks', false, '(id)');
