-- Engapp v0.2 İP1: practice_logs and the sync table registry.
--
-- practice_logs: one row per answer in a practice round ("Pratik turu"). Insert-only like
-- review_logs, but practice answers never feed FSRS: the client never replays them into a
-- card and never counts them in daily_activity or the streak (docs/decisions/0010).
--
-- public.sync_tables: the list of synced user tables. sync_push and the new sync_pull_v3
-- work from it, so a later package adds a synced table with one insert here (plus the table,
-- its trigger and RLS) instead of new sync functions. sync_pull and sync_pull_v2 are left
-- exactly as they were: they keep returning the six v0.1 tables, so a v0.1 client never
-- receives a table it does not know. A v0.1 client never pushes practice_logs either.

-- ---------------------------------------------------------------------------
-- practice_logs
-- ---------------------------------------------------------------------------
-- Checks are loose on purpose (as on review_logs): a rejected row would wait in the
-- outbox forever. `mode` is free text so that newer clients can add sources.

create table public.practice_logs (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  card_id uuid not null,
  practiced_at bigint not null check (practiced_at >= 0),
  result text not null check (result in ('known', 'unknown')),
  mode text not null check (char_length(mode) between 1 and 32),
  session_id uuid not null,
  duration_ms integer not null check (duration_ms >= 0),
  device_id text not null check (char_length(device_id) <= 100),
  created_at bigint not null check (created_at >= 0),
  hlc text not null check (public.is_hlc(hlc)),
  server_seq bigint not null default 0,
  server_updated_at timestamptz not null default now()
);

create index practice_logs_user_seq on public.practice_logs (user_id, server_seq);
create index practice_logs_card on public.practice_logs (card_id);

create trigger stamp_sync_row before insert or update on public.practice_logs
  for each row execute function public.tg_stamp_sync_row();

alter table public.practice_logs enable row level security;
revoke all on table public.practice_logs from anon, authenticated;
create policy "own rows: select" on public.practice_logs for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own rows: insert" on public.practice_logs for insert to authenticated
  with check (user_id = (select auth.uid()));
-- INSERT + SELECT only: no update/delete policy and no grant.
grant select, insert on table public.practice_logs to authenticated;

-- ---------------------------------------------------------------------------
-- sync table registry
-- ---------------------------------------------------------------------------

create table public.sync_tables (
  name text primary key check (name ~ '^[a-z][a-z0-9_]{0,62}$'),
  -- true: rows are never changed (INSERT ... ON CONFLICT DO NOTHING, deletes rejected).
  -- false: last-writer-wins by hlc, deletion is a tombstone (purged after 30 days).
  insert_only boolean not null,
  -- Conflict target of a mutable table's upsert.
  conflict_key text not null default '(id)' check (conflict_key in ('(id)', '(user_id, id)'))
);

insert into public.sync_tables (name, insert_only, conflict_key) values
  ('notes', false, '(id)'),
  ('senses', false, '(id)'),
  ('cards', false, '(id)'),
  ('review_logs', true, '(id)'),
  ('sources', false, '(id)'),
  ('settings', false, '(user_id, id)'),
  ('practice_logs', true, '(id)');

-- Readable by signed-in clients (the sync functions run as the caller); only the
-- migration owner writes it.
alter table public.sync_tables enable row level security;
revoke all on table public.sync_tables from anon, authenticated;
grant select on table public.sync_tables to authenticated;
create policy "registry: read" on public.sync_tables for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- push: registry-driven (same contract as 20261021000400_sync.sql)
-- ---------------------------------------------------------------------------

create or replace function public._sync_upsert(p_table text, p_payload jsonb)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_cols text;
  v_set text;
  v_conflict text;
  v_count integer;
begin
  select st.conflict_key into v_conflict from public.sync_tables st where st.name = p_table and not st.insert_only;
  if v_conflict is null then
    raise exception 'unknown table' using errcode = '22023';
  end if;

  select
    string_agg(format('%I', a.attname), ', ' order by a.attnum),
    string_agg(format('%1$I = excluded.%1$I', a.attname), ', ' order by a.attnum)
      filter (where a.attname not in ('id', 'user_id', 'created_at'))
  into v_cols, v_set
  from pg_catalog.pg_attribute a
  where a.attrelid = format('public.%I', p_table)::regclass
    and a.attnum > 0 and not a.attisdropped;

  execute format(
    'insert into public.%1$I as t (%2$s)
       select %2$s from jsonb_populate_record(null::public.%1$I, $1)
     on conflict %3$s do update set %4$s
       where t.hlc collate "C" < excluded.hlc collate "C"',
    p_table, v_cols, v_conflict, v_set)
  using p_payload;
  get diagnostics v_count = row_count;
  return case when v_count > 0 then 'applied' else 'stale' end;
end;
$$;

revoke all on function public._sync_upsert(text, jsonb) from public, anon;
grant execute on function public._sync_upsert(text, jsonb) to authenticated;

-- p_batch: [{table, op: 'upsert'|'delete', payload: {...row}}], at most 100 items.
-- Returns {acked: [id], stale: [id], rejected: [{table, id, code, message}]}; see
-- docs/sync-strategy.md. `table` must be in public.sync_tables.
create or replace function public.sync_push(p_batch jsonb)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_item jsonb;
  v_table text;
  v_op text;
  v_payload jsonb;
  v_id text;
  v_insert_only boolean;
  v_result text;
  v_count integer;
  v_now bigint := public.now_ms();
  v_acked jsonb := '[]'::jsonb;
  v_stale jsonb := '[]'::jsonb;
  v_rejected jsonb := '[]'::jsonb;
  v_state text;
  v_msg text;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_batch is null or jsonb_typeof(p_batch) <> 'array' then
    raise exception 'invalid_input: batch must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_batch) > 100 then
    raise exception 'invalid_input: at most 100 rows per batch' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_batch) loop
    v_table := v_item ->> 'table';
    v_op := v_item ->> 'op';
    v_payload := v_item -> 'payload';
    v_id := case when jsonb_typeof(v_payload) = 'object' then v_payload ->> 'id' end;

    begin
      v_insert_only := null;
      select st.insert_only into v_insert_only from public.sync_tables st where st.name = v_table;
      if v_insert_only is null then
        raise exception 'unknown table' using errcode = '22023';
      end if;
      if v_op is null or v_op not in ('upsert', 'delete') then
        raise exception 'unknown op' using errcode = '22023';
      end if;
      if v_id is null then
        raise exception 'payload.id is required' using errcode = '22023';
      end if;
      if (v_payload ->> 'hlc') is null or not public.is_hlc(v_payload ->> 'hlc') then
        raise exception 'payload.hlc is missing or malformed' using errcode = '22023';
      end if;

      -- Server-owned fields: never trust the client.
      v_payload := (v_payload - 'server_seq' - 'server_updated_at')
        || jsonb_build_object('user_id', v_uid);

      if v_insert_only then
        if v_op = 'delete' then
          raise exception '% are append-only', v_table using errcode = '42501';
        end if;
        execute format(
          'insert into public.%1$I as t
             select * from jsonb_populate_record(null::public.%1$I, $1)
           on conflict (id) do nothing',
          v_table)
        using v_payload;
        v_result := 'applied';
      elsif v_op = 'upsert' then
        v_result := public._sync_upsert(v_table, v_payload);
      else
        -- delete = tombstone. Payload may be the full row or just {id, hlc[, deleted_at, updated_at]}.
        v_payload := v_payload || jsonb_build_object(
          'deleted_at', coalesce((v_payload ->> 'deleted_at')::bigint, v_now),
          'updated_at', coalesce((v_payload ->> 'updated_at')::bigint, v_now));
        if v_payload ? 'created_at' then
          v_result := public._sync_upsert(v_table, v_payload);
        else
          execute format(
            'update public.%I as t
                set deleted_at = ($1 ->> ''deleted_at'')::bigint,
                    updated_at = ($1 ->> ''updated_at'')::bigint,
                    hlc = $1 ->> ''hlc''
              where t.id::text = $1 ->> ''id'' and t.user_id = $2
                and t.hlc collate "C" < ($1 ->> ''hlc'') collate "C"',
            v_table)
          using v_payload, v_uid;
          get diagnostics v_count = row_count;
          -- No row (never pushed, or already purged) or newer server row: nothing to do.
          v_result := case when v_count > 0 then 'applied' else 'stale' end;
        end if;
      end if;

      v_acked := v_acked || to_jsonb(v_id);
      if v_result = 'stale' then
        v_stale := v_stale || to_jsonb(v_id);
      end if;
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      v_rejected := v_rejected || jsonb_build_array(jsonb_build_object(
        'table', v_table, 'id', v_id, 'code', v_state, 'message', left(v_msg, 300)));
    end;
  end loop;

  return jsonb_build_object('acked', v_acked, 'stale', v_stale, 'rejected', v_rejected);
end;
$$;

revoke all on function public.sync_push(jsonb) from public, anon;
grant execute on function public.sync_push(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- pull v3: every registered table, same page contract as sync_pull_v2
-- ---------------------------------------------------------------------------

create or replace function public.sync_pull_v3(p_since bigint, p_limit integer, p_from bigint)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 500);
  v_since bigint := greatest(coalesce(p_since, 0), 0);
  v_from bigint := least(greatest(coalesce(p_from, p_since, 0), 0), greatest(coalesce(p_since, 0), 0));
  v_horizon bigint;
  v_union text;
  v_page jsonb;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select purged_through_seq into v_horizon from public.sync_horizon where user_id = v_uid;
  if v_from > 0 and v_from < coalesce(v_horizon, 0) then
    return jsonb_build_object('rows', '[]'::jsonb, 'next_seq', 0, 'has_more', false, 'full_resync', true);
  end if;

  -- One indexed branch per registered table (identifiers quoted with %I; the names come
  -- from the registry, never from the caller).
  select string_agg(format(
    '(select %L::text as tbl, t.server_seq as seq, to_jsonb(t) as r from public.%I t
       where t.user_id = $1 and t.server_seq > $2 order by t.server_seq limit $3)',
    st.name, st.name), ' union all ' order by st.name)
  into v_union
  from public.sync_tables st;

  execute format(
    'with u as (%s), page as (
       select * from u order by seq limit $3
     ), numbered as (
       select page.*, row_number() over (order by seq) as rn from page
     )
     select jsonb_build_object(
       ''rows'', coalesce(jsonb_agg(jsonb_build_object(
         ''table'', tbl, ''seq'', seq, ''row'', r - ''server_seq'' - ''server_updated_at'') order by seq)
         filter (where rn <= $4), ''[]''::jsonb),
       ''next_seq'', coalesce(max(seq) filter (where rn <= $4), $2),
       ''has_more'', count(*) > $4,
       ''full_resync'', false)
     from numbered', v_union)
  into v_page
  using v_uid, v_since, v_limit + 1, v_limit;

  return v_page;
end;
$$;

revoke all on function public.sync_pull_v3(bigint, integer, bigint) from public, anon;
grant execute on function public.sync_pull_v3(bigint, integer, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- purge: every registered mutable table (was a fixed list of the same five)
-- ---------------------------------------------------------------------------

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

  for t in select st.name from public.sync_tables st where not st.insert_only order by st.name loop
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
