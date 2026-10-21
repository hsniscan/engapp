-- Engapp: sync_pull_v2 — the tombstone-horizon check uses the cursor the pull STARTED at.
--
-- Bug in sync_pull (20261021000400_sync.sql): it answers full_resync whenever
-- 0 < p_since < purged_through_seq. A pull that starts at 0 (a new device, or the full
-- resync itself) pages with p_since = the previous page's next_seq, so once any tombstone
-- above the first page has been purged, page 2 of every full pull answered full_resync with
-- no rows. A full pull could then never get past its first page, and the client's full
-- resync removed every local row that was not on that page.
--
-- A pull that started at cursor p_from can only have missed a purged deletion when
-- p_from > 0 and p_from < purged_through_seq: rows with seq <= its current position were
-- seen already, and a pull from 0 needs no tombstones at all (rows that are gone are
-- removed by the full-resync cleanup). sync_pull is kept unchanged for clients that do
-- not know sync_pull_v2 yet.
create or replace function public.sync_pull_v2(p_since bigint, p_limit integer, p_from bigint)
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
  v_page jsonb;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select purged_through_seq into v_horizon from public.sync_horizon where user_id = v_uid;
  if v_from > 0 and v_from < coalesce(v_horizon, 0) then
    return jsonb_build_object('rows', '[]'::jsonb, 'next_seq', 0, 'has_more', false, 'full_resync', true);
  end if;

  -- The page itself is built exactly as in sync_pull.
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
  ), numbered as (
    select page.*, row_number() over (order by seq) as rn from page
  )
  select jsonb_build_object(
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'table', tbl, 'seq', seq, 'row', r - 'server_seq' - 'server_updated_at') order by seq)
      filter (where rn <= v_limit), '[]'::jsonb),
    'next_seq', coalesce(max(seq) filter (where rn <= v_limit), v_since),
    'has_more', count(*) > v_limit,
    'full_resync', false)
  into v_page
  from numbered;

  return v_page;
end;
$$;

revoke all on function public.sync_pull_v2(bigint, integer, bigint) from public, anon;
grant execute on function public.sync_pull_v2(bigint, integer, bigint) to authenticated;
