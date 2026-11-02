-- Engapp v0.5.2 (decision 0060): sync that cannot be stalled or flooded by one account.
--
-- 1. sync_pull_v4: pages bounded by bytes as well as rows (review S3). sync_pull_v3 built the
--    JSON of up to 501 rows per table before trimming to 500; with user_texts bodies of up to
--    300,000 characters a page could be 50-150 MB, time out every time and never move the
--    cursor. v4 first picks the page from (table, seq, estimated size) only, keeps rows while
--    the running size stays under p_max_bytes (always at least one row, so a single big row
--    still moves the cursor), then builds JSON for the kept rows only.
-- 2. Reading progress no longer moves the text body. In an incremental pull a user_texts
--    row whose body has not changed since the caller's cursor (body_seq <= p_since) comes
--    without `body` and with `body_bytes`; the client keeps its own copy (it re-fetches the
--    body by id if it has none). On the way up, sync_push accepts a user_texts upsert without
--    `body` and updates every other column of the existing row (the client sends progress,
--    finished and feedback changes this way); for a row the server does not have yet it
--    answers 23502 and the client sends the full row.
-- 3. Per-user limits (review S5): sync_push counts calls, rows and bytes per user and day
--    (sync_usage) and refuses past the daily limits; user_texts has a row and byte quota per
--    user (checked when a text is added).
-- 4. A row whose HLC lies more than a day in the future is rejected (review S16): a device
--    with a wrong clock can no longer write rows nobody else can overwrite.

-- ---------------------------------------------------------------------------
-- user_texts.body_seq: the server_seq at which the body last changed
-- ---------------------------------------------------------------------------

alter table public.user_texts add column body_seq bigint not null default 0;

-- Runs after stamp_sync_row (triggers fire in name order), so new.server_seq is set.
create or replace function public.tg_user_texts_body_seq()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.body is distinct from old.body then
    new.body_seq := new.server_seq;
  else
    new.body_seq := old.body_seq;
  end if;
  return new;
end;
$$;

create trigger stamp_sync_row_body before insert or update on public.user_texts
  for each row execute function public.tg_user_texts_body_seq();

revoke all on function public.tg_user_texts_body_seq() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- quotas
-- ---------------------------------------------------------------------------

-- Kept in a table so the owner can change them without a migration (service role / SQL).
create table public.sync_limits (
  name text primary key check (name ~ '^[a-z][a-z0-9_]{0,47}$'),
  value bigint not null check (value > 0)
);
alter table public.sync_limits enable row level security;
revoke all on table public.sync_limits from anon, authenticated;

insert into public.sync_limits (name, value) values
  -- per user and UTC day, all synced tables together
  ('push_calls_per_day', 20000),
  ('push_rows_per_day', 300000),        -- an Anki history import of a few years fits
  ('push_bytes_per_day', 314572800),    -- 300 MB
  -- reading texts per user (live and deleted rows until the purge)
  ('texts_per_user', 2000),
  ('text_bytes_per_user', 104857600);   -- 100 MB of text

create table public.sync_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  calls integer not null default 0 check (calls >= 0),
  rows integer not null default 0 check (rows >= 0),
  bytes bigint not null default 0 check (bytes >= 0),
  primary key (user_id, day)
);
create index sync_usage_day on public.sync_usage (day);
alter table public.sync_usage enable row level security;
revoke all on table public.sync_usage from anon, authenticated;

-- Counts one sync_push call of the signed-in user and raises 53400 past a daily limit.
-- SECURITY DEFINER so clients need no grant on sync_usage; it only ever touches the
-- caller's own row (auth.uid()).
create or replace function public.sync_rate_consume(p_rows integer, p_bytes bigint)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_day date := (now() at time zone 'utc')::date;
  v_calls integer;
  v_rows integer;
  v_bytes bigint;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  insert into public.sync_usage as u (user_id, day, calls, rows, bytes)
  values (v_uid, v_day, 1, greatest(p_rows, 0), greatest(p_bytes, 0))
  on conflict (user_id, day) do update set
    calls = u.calls + 1, rows = u.rows + excluded.rows, bytes = u.bytes + excluded.bytes
  returning calls, rows, bytes into v_calls, v_rows, v_bytes;
  if v_calls > (select value from public.sync_limits where name = 'push_calls_per_day')
     or v_rows > (select value from public.sync_limits where name = 'push_rows_per_day')
     or v_bytes > (select value from public.sync_limits where name = 'push_bytes_per_day') then
    raise exception 'quota: daily sync limit reached, try again tomorrow' using errcode = '53400';
  end if;
end;
$$;

revoke all on function public.sync_rate_consume(integer, bigint) from public, anon;
grant execute on function public.sync_rate_consume(integer, bigint) to authenticated;

-- A new text must fit the user's text quota.
create or replace function public.tg_user_texts_quota()
returns trigger
language plpgsql
security definer -- counts the user's rows regardless of the caller's grants
set search_path = ''
as $$
declare
  v_rows bigint;
  v_bytes bigint;
begin
  select count(*), coalesce(sum(octet_length(t.body)), 0) into v_rows, v_bytes
  from public.user_texts t where t.user_id = new.user_id;
  if v_rows + 1 > (select value from public.sync_limits where name = 'texts_per_user')
     or v_bytes + octet_length(new.body) > (select value from public.sync_limits where name = 'text_bytes_per_user') then
    raise exception 'quota: too many saved texts' using errcode = '53400';
  end if;
  return new;
end;
$$;

create trigger quota_user_texts before insert on public.user_texts
  for each row execute function public.tg_user_texts_quota();

revoke all on function public.tg_user_texts_quota() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- partial update (a user_texts row without its body)
-- ---------------------------------------------------------------------------

-- Updates the columns present in p_payload of the caller's existing row, last writer wins
-- (HLC). 'applied' / 'stale'; raises 23502 when the row does not exist (then the client must
-- send the full row). SECURITY INVOKER: RLS applies.
create or replace function public._sync_update_partial(p_table text, p_payload jsonb)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_set text;
  v_count integer;
begin
  if not exists (select 1 from public.sync_tables st where st.name = p_table and not st.insert_only) then
    raise exception 'unknown table' using errcode = '22023';
  end if;
  select string_agg(format('%1$I = case when $1 ? %1$L then r.%1$I else t.%1$I end', a.attname), ', ' order by a.attnum)
  into v_set
  from pg_catalog.pg_attribute a
  where a.attrelid = format('public.%I', p_table)::regclass
    and a.attnum > 0 and not a.attisdropped
    and a.attname not in ('id', 'user_id', 'created_at', 'server_seq', 'server_updated_at', 'body_seq');

  execute format(
    'update public.%1$I as t set %2$s
       from jsonb_populate_record(null::public.%1$I, $1) as r
      where t.id = r.id and t.user_id = $2 and t.hlc collate "C" < r.hlc collate "C"',
    p_table, v_set)
  using p_payload, auth.uid();
  get diagnostics v_count = row_count;
  if v_count > 0 then
    return 'applied';
  end if;
  execute format('select count(*) from public.%I t where t.id::text = $1 and t.user_id = $2', p_table)
  into v_count using p_payload ->> 'id', auth.uid();
  if v_count = 0 then
    raise exception 'row not on the server yet: send the full row' using errcode = '23502';
  end if;
  return 'stale';
end;
$$;

revoke all on function public._sync_update_partial(text, jsonb) from public, anon;
grant execute on function public._sync_update_partial(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- sync_push: as 20261021000900_practice.sql, plus the limits, the HLC bound and the
-- body-less user_texts update
-- ---------------------------------------------------------------------------

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
  -- A client clock may run a little fast; a day ahead is a broken clock.
  v_hlc_max bigint := public.now_ms() + 86400000;
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

  perform public.sync_rate_consume(jsonb_array_length(p_batch), octet_length(p_batch::text));

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
      if left(v_payload ->> 'hlc', 15)::bigint > v_hlc_max then
        raise exception 'payload.hlc is in the future (check the device clock)' using errcode = '22023';
      end if;

      -- Server-owned fields: never trust the client.
      v_payload := (v_payload - 'server_seq' - 'server_updated_at' - 'body_seq')
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
      elsif v_op = 'upsert' and v_table = 'user_texts' and not (v_payload ? 'body') then
        -- Progress / finished / feedback of a text the server has: the body stays as it is.
        v_result := public._sync_update_partial(v_table, v_payload);
      elsif v_op = 'upsert' then
        v_result := public._sync_upsert(v_table, v_payload);
      else
        -- delete = tombstone. Payload may be the full row or just {id, hlc[, deleted_at, updated_at]}.
        v_payload := v_payload || jsonb_build_object(
          'deleted_at', coalesce((v_payload ->> 'deleted_at')::bigint, v_now),
          'updated_at', coalesce((v_payload ->> 'updated_at')::bigint, v_now));
        if v_payload ? 'created_at' and not (v_table = 'user_texts' and not (v_payload ? 'body')) then
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
-- sync_pull_v4
-- ---------------------------------------------------------------------------

-- Same page contract as sync_pull_v3 ({rows, next_seq, has_more, full_resync}); rows are
-- cut at p_max_bytes (estimated JSON size; 64 KB .. 8 MB, default 1 MB) as well as p_limit.
-- With p_from > 0 (an incremental pull) user_texts rows whose body is older than p_since
-- come without `body`, with `body_bytes` (UTF-8 length) instead.
create or replace function public.sync_pull_v4(
  p_since bigint, p_limit integer, p_from bigint, p_max_bytes integer default 1048576)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 500);
  v_max bigint := least(greatest(coalesce(p_max_bytes, 1048576), 65536), 8388608);
  v_since bigint := greatest(coalesce(p_since, 0), 0);
  v_from bigint := least(greatest(coalesce(p_from, p_since, 0), 0), greatest(coalesce(p_since, 0), 0));
  v_slim boolean;
  v_horizon bigint;
  v_union text;
  v_keys jsonb;
  v_more boolean;
  v_next bigint;
  v_all jsonb := '[]'::jsonb;
  v_part jsonb;
  v_text_cols text;
  r record;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  v_slim := v_from > 0;

  select purged_through_seq into v_horizon from public.sync_horizon where user_id = v_uid;
  if v_from > 0 and v_from < coalesce(v_horizon, 0) then
    return jsonb_build_object('rows', '[]'::jsonb, 'next_seq', 0, 'has_more', false, 'full_resync', true);
  end if;

  -- 1. The page: (table, seq, estimated JSON bytes) per row, no row JSON yet. octet_length()
  --    of a text reads the stored length without fetching a TOASTed body.
  select string_agg(format(
    '(select %L::text as tbl, t.server_seq as seq, %s::bigint as sz from public.%I t
       where t.user_id = $1 and t.server_seq > $2 order by t.server_seq limit $3)',
    st.name,
    case when st.name = 'user_texts'
      then '600 + coalesce(octet_length(t.title), 0) + 2 * coalesce(pg_column_size(t.story), 0)'
           || ' + case when $4 and t.body_seq <= $2 then 20 else (coalesce(octet_length(t.body), 0) * 11) / 10 end'
      else '200 + 2 * pg_column_size(t.*)' end,
    st.name), ' union all ' order by st.name)
  into v_union
  from public.sync_tables st;

  execute format(
    'with u as (%s), page as (
       select * from u order by seq limit $3
     ), numbered as (
       select tbl, seq, row_number() over (order by seq) as rn,
              sum(sz) over (order by seq rows between unbounded preceding and current row) as cum
       from page
     ), marked as (
       select tbl, seq, (rn <= $5 and (rn = 1 or cum <= $6)) as keep from numbered
     )
     select coalesce(jsonb_agg(jsonb_build_array(tbl, seq) order by seq) filter (where keep), ''[]''::jsonb),
            coalesce(bool_or(not keep), false),
            max(seq) filter (where keep)
     from marked', v_union)
  into v_keys, v_more, v_next
  using v_uid, v_since, v_limit + 1, v_slim, v_limit, v_max;

  -- 2. JSON of the kept rows, table by table (same snapshot: the function is STABLE).
  select string_agg(format('%L, t.%I', a.attname, a.attname), ', ' order by a.attnum)
  into v_text_cols
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.user_texts'::regclass and a.attnum > 0 and not a.attisdropped
    and a.attname not in ('body', 'server_seq', 'server_updated_at', 'body_seq');

  for r in
    select k ->> 0 as tbl, array_agg((k ->> 1)::bigint) as seqs
    from jsonb_array_elements(v_keys) k group by 1
  loop
    if r.tbl = 'user_texts' then
      execute format(
        'select coalesce(jsonb_agg(jsonb_build_object(''table'', ''user_texts'', ''seq'', t.server_seq, ''row'',
            case when $3 and t.body_seq <= $4
              then jsonb_build_object(%s) || jsonb_build_object(''body_bytes'', coalesce(octet_length(t.body), 0))
              else to_jsonb(t) - ''server_seq'' - ''server_updated_at'' - ''body_seq'' end)), ''[]''::jsonb)
           from public.user_texts t where t.user_id = $1 and t.server_seq = any ($2)', v_text_cols)
      into v_part
      using v_uid, r.seqs, v_slim, v_since;
    else
      execute format(
        'select coalesce(jsonb_agg(jsonb_build_object(''table'', %L, ''seq'', t.server_seq, ''row'',
            to_jsonb(t) - ''server_seq'' - ''server_updated_at'')), ''[]''::jsonb)
           from public.%I t where t.user_id = $1 and t.server_seq = any ($2)', r.tbl, r.tbl)
      into v_part
      using v_uid, r.seqs;
    end if;
    v_all := v_all || v_part;
  end loop;

  return jsonb_build_object(
    'rows', coalesce((select jsonb_agg(e order by (e ->> 'seq')::bigint) from jsonb_array_elements(v_all) e), '[]'::jsonb),
    'next_seq', coalesce(v_next, v_since),
    'has_more', v_more,
    'full_resync', false);
end;
$$;

revoke all on function public.sync_pull_v4(bigint, integer, bigint, integer) from public, anon;
grant execute on function public.sync_pull_v4(bigint, integer, bigint, integer) to authenticated;

-- The usage counters are deleted after 90 days like the other daily counters.
create or replace function public.purge_ops_counters(p_days integer default 90)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_cutoff date := (now() at time zone 'utc')::date - greatest(p_days, 1);
  v_feature integer;
  v_events integer;
  v_users integer;
  v_sync integer;
begin
  delete from public.ai_feature_usage where day < v_cutoff;
  get diagnostics v_feature = row_count;
  delete from public.ops_events where at < v_cutoff;
  get diagnostics v_events = row_count;
  delete from public.text_budget_users
  where month < (date_trunc('month', now() at time zone 'utc') - interval '1 month')::date;
  get diagnostics v_users = row_count;
  delete from public.sync_usage where day < v_cutoff;
  get diagnostics v_sync = row_count;
  return jsonb_build_object('ai_feature_usage', v_feature, 'ops_events', v_events,
    'text_budget_users', v_users, 'sync_usage', v_sync);
end;
$$;

revoke all on function public.purge_ops_counters(integer) from public, anon, authenticated;
grant execute on function public.purge_ops_counters(integer) to service_role;
