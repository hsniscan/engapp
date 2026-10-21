-- Engapp: sync transport as Postgres RPC functions (called with supabase.rpc()).
--
-- Why RPC and not edge functions: these run SECURITY INVOKER as the signed-in user, so
-- every read and write goes through the same RLS policies as direct table access; a
-- whole push batch is one transaction; and there is no service key involved.
-- user_id is never taken from the client: it is overwritten with auth.uid().

-- Tombstone horizon per user: highest server_seq of any purged tombstone.
-- A device whose cursor is below it may have missed a deletion -> full resync.
create table public.sync_horizon (
  user_id uuid primary key references auth.users (id) on delete cascade,
  purged_through_seq bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.sync_horizon enable row level security;
revoke all on table public.sync_horizon from anon, authenticated;
grant select on table public.sync_horizon to authenticated;
create policy "own horizon: select" on public.sync_horizon for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- push
-- ---------------------------------------------------------------------------

-- Upserts one row with last-writer-wins on hlc. Returns 'applied' or 'stale'.
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
  select
    string_agg(format('%I', a.attname), ', ' order by a.attnum),
    string_agg(format('%1$I = excluded.%1$I', a.attname), ', ' order by a.attnum)
      filter (where a.attname not in ('id', 'user_id', 'created_at'))
  into v_cols, v_set
  from pg_catalog.pg_attribute a
  where a.attrelid = format('public.%I', p_table)::regclass
    and a.attnum > 0 and not a.attisdropped;

  v_conflict := case when p_table = 'settings' then '(user_id, id)' else '(id)' end;

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
-- Returns {acked: [id], stale: [id], rejected: [{table, id, code, message}]}.
--   acked     the server holds this change or a newer one; delete the outbox row.
--             (stale ids are also in acked.)
--   stale     subset of acked whose payload lost last-writer-wins; the newer server
--             row will arrive with the next pull.
--   rejected  invalid row (constraint, type or RLS error); keep it in the outbox,
--             count an attempt, show a warning after 10 attempts.
-- Each item runs in its own subtransaction, so one bad row does not fail the batch.
-- Idempotent: re-sending a batch gives the same server state.
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
      if v_table is null or v_table not in ('notes', 'senses', 'cards', 'review_logs', 'sources', 'settings') then
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

      if v_table = 'review_logs' then
        if v_op = 'delete' then
          raise exception 'review_logs are append-only' using errcode = '42501';
        end if;
        insert into public.review_logs as t
          select * from jsonb_populate_record(null::public.review_logs, v_payload)
        on conflict (id) do nothing;
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
-- pull
-- ---------------------------------------------------------------------------

-- Rows of all user tables with server_seq > p_since, ordered by server_seq.
-- Returns {rows: [{table, seq, row}], next_seq, has_more, full_resync}.
--   row        the row as the client stores it (server_seq/server_updated_at removed)
--   next_seq   store it as sync_cursor in the same Dexie transaction as the rows
--   has_more   call again with next_seq
--   full_resync  the cursor is older than the tombstone horizon (purged deletions
--              could have been missed): push pending changes, then pull from 0 and
--              drop local synced rows that the full pull did not return.
create or replace function public.sync_pull(p_since bigint default 0, p_limit integer default 500)
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
  v_horizon bigint;
  v_rows jsonb;
  v_count integer;
  v_next bigint;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select purged_through_seq into v_horizon from public.sync_horizon where user_id = v_uid;
  if v_since > 0 and v_since < coalesce(v_horizon, 0) then
    return jsonb_build_object('rows', '[]'::jsonb, 'next_seq', 0, 'has_more', false, 'full_resync', true);
  end if;

  with u as (
    (select 'notes' as tbl, t.server_seq as seq, to_jsonb(t) as r from public.notes t
      where t.user_id = v_uid and t.server_seq > v_since order by t.server_seq limit v_limit + 1)
    union all
    (select 'senses', t.server_seq, to_jsonb(t) from public.senses t
      where t.user_id = v_uid and t.server_seq > v_since order by t.server_seq limit v_limit + 1)
    union all
    (select 'cards', t.server_seq, to_jsonb(t) from public.cards t
      where t.user_id = v_uid and t.server_seq > v_since order by t.server_seq limit v_limit + 1)
    union all
    (select 'review_logs', t.server_seq, to_jsonb(t) from public.review_logs t
      where t.user_id = v_uid and t.server_seq > v_since order by t.server_seq limit v_limit + 1)
    union all
    (select 'sources', t.server_seq, to_jsonb(t) from public.sources t
      where t.user_id = v_uid and t.server_seq > v_since order by t.server_seq limit v_limit + 1)
    union all
    (select 'settings', t.server_seq, to_jsonb(t) from public.settings t
      where t.user_id = v_uid and t.server_seq > v_since order by t.server_seq limit v_limit + 1)
  ), page as (
    select * from u order by seq limit v_limit + 1
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'table', tbl, 'seq', seq, 'row', r - 'server_seq' - 'server_updated_at') order by seq)
      filter (where rn <= v_limit), '[]'::jsonb),
    count(*),
    max(seq) filter (where rn <= v_limit)
  into v_rows, v_count, v_next
  from (select page.*, row_number() over (order by seq) as rn from page) p;

  return jsonb_build_object(
    'rows', v_rows,
    'next_seq', coalesce(v_next, v_since),
    'has_more', v_count > v_limit,
    'full_resync', false);
end;
$$;

revoke all on function public.sync_pull(bigint, integer) from public, anon;
grant execute on function public.sync_pull(bigint, integer) to authenticated;

-- Lexicon senses referenced by the caller's senses with lexicon server_seq > p_since.
-- Returns {rows: [LexiconSense], next_seq, has_more}.
-- Note: a sense that is older than the device's lexicon cursor but newly referenced
-- (e.g. a note synced from another device) is not returned here; fetch such gaps by id
-- with lexicon_get().
create or replace function public.lexicon_pull(p_since bigint default 0, p_limit integer default 500)
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
  v_rows jsonb;
  v_count integer;
  v_next bigint;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  with page as (
    select e.* from public.lexicon_entries e
    where e.server_seq > v_since
      and e.id in (select s.lexicon_sense_id from public.senses s
                   where s.user_id = v_uid and s.lexicon_sense_id is not null)
    order by e.server_seq
    limit v_limit + 1
  ), numbered as (
    select page.*, row_number() over (order by server_seq) as rn from page
  )
  select
    coalesce(jsonb_agg(to_jsonb(n) - 'rn' - 'server_seq' order by n.server_seq)
      filter (where n.rn <= v_limit), '[]'::jsonb),
    count(*),
    max(n.server_seq) filter (where n.rn <= v_limit)
  into v_rows, v_count, v_next
  from numbered n;

  return jsonb_build_object('rows', v_rows, 'next_seq', coalesce(v_next, v_since), 'has_more', v_count > v_limit);
end;
$$;

revoke all on function public.lexicon_pull(bigint, integer) from public, anon;
grant execute on function public.lexicon_pull(bigint, integer) to authenticated;

-- LexiconSense rows by id (max 500). For filling lexicon_cache gaps.
create or replace function public.lexicon_get(p_ids uuid[])
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(e) - 'server_seq' order by e.lemma_norm, e.id), '[]'::jsonb)
  from public.lexicon_entries e
  where e.id = any (p_ids[1:500])
$$;

revoke all on function public.lexicon_get(uuid[]) from public, anon;
grant execute on function public.lexicon_get(uuid[]) to authenticated, service_role;
