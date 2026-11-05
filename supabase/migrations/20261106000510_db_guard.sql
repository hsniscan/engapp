-- Engapp v0.5.3 (decision 0075, review "sağlamlık" item 2): one account can no longer fill the
-- Free plan's 500 MB database, and a nearly full database keeps the essentials working.
--
-- 1. Per-user limits sized for the Free plan (they were sized for a paid one: 300 MB of pushes
--    a day, 100 MB of texts per user). Measured on the live data (ADR 0075): a review log is
--    about 300 B stored with its indexes and 350-450 B on the wire; a card, note or sense
--    400-600 B; a heavy daily learner pushes about 150-300 KB a day. The new limits leave a
--    100x margin for normal use, let a large Anki history arrive over a few days (the outbox
--    simply waits), and cap one account at about 20-25 MB of new rows a day, so the ~370 MB of
--    head room cannot go in a day, and the 350 MB e-mail (scripts/ops-health.sh) comes first.
--    `least()`: a value the owner already set lower stays.
-- 2. A database-wide guard: db_guard_refresh() (pg_cron, every 15 minutes) stores
--    pg_database_size() in a one-row table, so a push never measures the database itself.
--    While the size is above sync_limits.db_guard_bytes (420 MB), new text bodies (user_texts)
--    and imported Anki answers are refused per row with SQLSTATE 53400 and a 'storage_full'
--    message; the client keeps them in its outbox and says so in plain words. Answers given in
--    the app, cards, words, settings and every other row keep syncing.

update public.sync_limits set value = least(value, 5000) where name = 'push_calls_per_day';
update public.sync_limits set value = least(value, 50000) where name = 'push_rows_per_day';
update public.sync_limits set value = least(value, 20971520) where name = 'push_bytes_per_day';   -- 20 MB
update public.sync_limits set value = least(value, 300) where name = 'texts_per_user';
update public.sync_limits set value = least(value, 5242880) where name = 'text_bytes_per_user';  -- 5 MB

insert into public.sync_limits (name, value) values
  ('db_guard_bytes', 440401920)   -- 420 MB: above this, only essential writes are taken
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- the cached database size
-- ---------------------------------------------------------------------------

create table public.db_guard (
  id boolean primary key default true check (id),
  db_bytes bigint not null default 0 check (db_bytes >= 0),
  checked_at timestamptz not null default now()
);
insert into public.db_guard (id) values (true);
alter table public.db_guard enable row level security;
revoke all on table public.db_guard from anon, authenticated;

-- Measures the database and stores the size (pg_cron every 15 minutes, and the nightly health
-- check). Returns {db_bytes, limit_bytes, active}.
create or replace function public.db_guard_refresh()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_size bigint := pg_catalog.pg_database_size(pg_catalog.current_database());
  v_limit bigint := coalesce((select l.value from public.sync_limits l where l.name = 'db_guard_bytes'), 440401920);
begin
  insert into public.db_guard as g (id, db_bytes, checked_at) values (true, v_size, now())
  on conflict (id) do update set db_bytes = excluded.db_bytes, checked_at = excluded.checked_at;
  return jsonb_build_object('db_bytes', v_size, 'limit_bytes', v_limit, 'active', v_size > v_limit);
end;
$$;

revoke all on function public.db_guard_refresh() from public, anon, authenticated;
grant execute on function public.db_guard_refresh() to service_role;

-- Is the guard on? Reads the cached size only (one row).
create or replace function public.db_guard_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select g.db_bytes from public.db_guard g where g.id)
      > coalesce((select l.value from public.sync_limits l where l.name = 'db_guard_bytes'), 440401920),
    false)
$$;

revoke all on function public.db_guard_active() from public, anon;
grant execute on function public.db_guard_active() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- the guard on non-essential writes
-- ---------------------------------------------------------------------------

-- user_texts: a new text, or a new body for a text. Progress, "Bitirdim", feedback and deletes
-- (no body change) still go through. Named to run before quota_user_texts and stamp_sync_row
-- (BEFORE triggers fire in name order).
create or replace function public.tg_db_guard_texts()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' or new.body is distinct from old.body)
     and pg_catalog.octet_length(new.body) > 0
     and public.db_guard_active() then
    raise exception 'storage_full: the server is nearly full, the text waits on the device'
      using errcode = '53400';
  end if;
  return new;
end;
$$;

create trigger quota_db_guard before insert or update of body on public.user_texts
  for each row execute function public.tg_db_guard_texts();

revoke all on function public.tg_db_guard_texts() from public, anon, authenticated;

-- review_logs imported from Anki (a bulk history, origin 'anki'); answers given in the app are
-- never refused.
create or replace function public.tg_db_guard_bulk_logs()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if public.db_guard_active() then
    raise exception 'storage_full: the server is nearly full, imported answers wait on the device'
      using errcode = '53400';
  end if;
  return new;
end;
$$;

create trigger quota_db_guard before insert on public.review_logs
  for each row when (new.origin = 'anki') execute function public.tg_db_guard_bulk_logs();

revoke all on function public.tg_db_guard_bulk_logs() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- storage health for the nightly check (scripts/ops-health.sh prints it after ops_health())
-- ---------------------------------------------------------------------------

-- db_guard: 'fail' while the guard refuses writes (the run e-mails the owner).
-- top_tables: the ten largest tables with indexes and TOAST, so growth has a name.
-- cron_history: rows in cron.job_run_details (purged after 7 days by 20261106000520).
create or replace function public.ops_storage_health()
returns table (check_name text, status text, detail text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_guard jsonb := public.db_guard_refresh();
  v_n bigint;
begin
  check_name := 'db_guard';
  detail := ((v_guard ->> 'db_bytes')::bigint / 1048576) || ' MB of ' || ((v_guard ->> 'limit_bytes')::bigint / 1048576)
    || ' MB; above it new texts and Anki imports wait on the devices';
  status := case when (v_guard ->> 'active')::boolean then 'fail' else 'ok' end;
  return next;

  select string_agg(x.name || ' ' || x.mb || ' MB', ', ' order by x.bytes desc) into detail
  from (
    select c.relname as name, pg_catalog.pg_total_relation_size(c.oid) as bytes,
           round(pg_catalog.pg_total_relation_size(c.oid) / 1048576.0, 1) as mb
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'm') and n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
    order by pg_catalog.pg_total_relation_size(c.oid) desc
    limit 10
  ) x;
  check_name := 'top_tables'; status := 'info';
  return next;

  if pg_catalog.to_regclass('cron.job_run_details') is not null then
    execute 'select count(*) from cron.job_run_details' into v_n;
    check_name := 'cron_history'; detail := v_n || ' pg_cron run records kept';
    status := case when v_n > 20000 then 'warn' else 'ok' end;
    return next;
  end if;
end;
$$;

revoke all on function public.ops_storage_health() from public, anon, authenticated;
grant execute on function public.ops_storage_health() to service_role;

select public.db_guard_refresh();

-- Every 15 minutes with pg_cron when available (as the push job, 20261023000600).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('engapp-db-guard', '*/15 * * * *', 'select public.db_guard_refresh()');
  else
    raise notice 'pg_cron is not available: schedule public.db_guard_refresh() manually';
  end if;
exception when others then
  raise notice 'could not schedule the database guard with pg_cron (%): schedule public.db_guard_refresh() manually', sqlerrm;
end;
$$;
