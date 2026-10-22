-- Engapp: account deletion (v0.4 İP7, docs/decisions/0035-account-deletion.md).
--
-- The account-delete edge function removes a user's files, then calls
-- delete_user_data(user), then deletes the auth user with the Admin API. Every user-scoped
-- table already references auth.users (id) ON DELETE CASCADE, so the last step alone would
-- remove the rows too; deleting them first, explicitly and in one transaction, means a
-- failure between the steps never leaves data behind an account that is already gone, and
-- a retry finishes the job (every step is idempotent).
--
-- "User-scoped" is defined by the catalog, not by a list: every column of a public table
-- with a foreign key to auth.users. A future table that forgets the foreign key is caught by
-- supabase/tests/database/22_account_delete.test.sql (every user_id column must have one,
-- with ON DELETE CASCADE).
--
-- The shared tables (lexicon_*, ref_*, ai_system_usage, sync_tables, push_cron_config) have
-- no user column and are never touched: they hold dictionary content only (docs/ai-pipeline.md
-- "Rules"; AGENTS.md rule 5), never a user's sentence or id.

-- ---------------------------------------------------------------------------
-- The columns that tie a row to an auth user: (table, column, cascades).
-- ---------------------------------------------------------------------------
create or replace function public.user_owned_columns()
returns table (table_name text, column_name text, cascades boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  select cl.relname::text, a.attname::text, con.confdeltype = 'c'
  from pg_catalog.pg_constraint con
  join pg_catalog.pg_class cl on cl.oid = con.conrelid
  join pg_catalog.pg_namespace n on n.oid = cl.relnamespace
  join pg_catalog.pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
  where con.contype = 'f'
    and con.confrelid = 'auth.users'::pg_catalog.regclass
    and n.nspname = 'public'
    and pg_catalog.array_length(con.conkey, 1) = 1
  order by 1, 2
$$;

revoke all on function public.user_owned_columns() from public, anon, authenticated;
grant execute on function public.user_owned_columns() to service_role;

-- ---------------------------------------------------------------------------
-- Deletes every row of p_user in every user-scoped table. Returns {table: rows deleted}
-- (tables with no rows are left out). Idempotent: a second call returns {}.
-- review_logs and practice_logs are insert-only for clients (RLS, no delete grant); this
-- is the one place where they are deleted, because the account itself is going away.
-- ---------------------------------------------------------------------------
create or replace function public.delete_user_data(p_user uuid)
returns jsonb
language plpgsql
volatile
security definer -- runs as the owner: deletes regardless of the table grants
set search_path = ''
as $$
declare
  r record;
  n bigint;
  result jsonb := '{}'::jsonb;
begin
  if p_user is null then
    raise exception 'p_user is required' using errcode = '22023';
  end if;
  -- Same lock as tg_stamp_sync_row: a sync push of this user that is in flight finishes
  -- first, and one that starts later waits for this transaction (and then fails on the
  -- foreign key once the auth user is gone).
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('engapp.sync:' || p_user::text, 0));
  for r in select * from public.user_owned_columns() loop
    execute pg_catalog.format('delete from public.%I where %I = $1', r.table_name, r.column_name)
      using p_user;
    get diagnostics n = row_count;
    if n > 0 then
      result := result || pg_catalog.jsonb_build_object(r.table_name, n);
    end if;
  end loop;
  return result;
end;
$$;

revoke all on function public.delete_user_data(uuid) from public, anon, authenticated;
grant execute on function public.delete_user_data(uuid) to service_role;
