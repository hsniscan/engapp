-- Engapp: maintenance (tombstone purge, cache expiry) and the RLS guard.

-- Deletes tombstones whose last server write is older than p_days (server clock, so a
-- wrong device clock cannot shorten the window), advances each affected user's
-- sync_horizon, and expires AI caches/counters. Returns per-table counts.
create or replace function public.purge_tombstones(p_days integer default 30)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz := now() - make_interval(days => greatest(p_days, 1));
  v_result jsonb := '{}'::jsonb;
  v_count integer;
  t text;
begin
  create temporary table if not exists _purged (user_id uuid, seq bigint) on commit drop;

  foreach t in array array['notes', 'senses', 'cards', 'sources', 'settings'] loop
    execute format(
      'with d as (
         delete from public.%I where deleted_at is not null and server_updated_at < $1
         returning user_id, server_seq)
       insert into _purged select user_id, server_seq from d', t)
    using v_cutoff;
    get diagnostics v_count = row_count;
    v_result := v_result || jsonb_build_object(t, v_count);
  end loop;

  insert into public.sync_horizon as h (user_id, purged_through_seq, updated_at)
  select user_id, max(seq), now() from _purged group by user_id
  on conflict (user_id) do update
    set purged_through_seq = greatest(h.purged_through_seq, excluded.purged_through_seq),
        updated_at = now();

  delete from public.ai_chunk_cache where created_at < now() - interval '90 days';
  get diagnostics v_count = row_count;
  v_result := v_result || jsonb_build_object('ai_chunk_cache', v_count);

  delete from public.ai_usage where day < (now() at time zone 'utc')::date - 90;
  get diagnostics v_count = row_count;
  v_result := v_result || jsonb_build_object('ai_usage', v_count);

  drop table if exists _purged;
  return v_result;
end;
$$;

revoke all on function public.purge_tombstones(integer) from public, anon, authenticated;
grant execute on function public.purge_tombstones(integer) to service_role;

-- Schedule it daily at 03:17 UTC with pg_cron when the extension is available
-- (it is on Supabase; enable it under Database > Extensions if this notice appears).
-- Without pg_cron run `select public.purge_tombstones(30);` from the SQL editor or a
-- scheduled job. See docs/setup-backend.md.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('engapp-purge-tombstones', '17 3 * * *', 'select public.purge_tombstones(30)');
  else
    raise notice 'pg_cron is not available: schedule public.purge_tombstones(30) manually';
  end if;
exception when others then
  raise notice 'could not schedule purge with pg_cron (%): schedule public.purge_tombstones(30) manually', sqlerrm;
end;
$$;

-- Lists tables in the public schema without row level security. Must return no rows;
-- checked by supabase/tests/database/00_rls_enabled.test.sql (run in CI).
create or replace function public.tables_without_rls()
returns table (table_name text)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.relname::text
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and not c.relrowsecurity
  order by 1
$$;

revoke all on function public.tables_without_rls() from public, anon, authenticated;
grant execute on function public.tables_without_rls() to service_role;
