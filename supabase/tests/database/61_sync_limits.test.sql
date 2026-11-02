-- Sync limits (20261103000200_sync_limits.sql, decision 0060): byte-bounded pull pages,
-- text bodies that do not travel again with progress changes, per-user quotas and daily
-- push limits, and the future-HLC guard.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

insert into auth.users (id, email, aud, role) values
  ('61616161-6161-4161-8161-616161616101', 's1@test.local', 'authenticated', 'authenticated');

set local request.jwt.claims to '{"sub":"61616161-6161-4161-8161-616161616101","role":"authenticated"}';
set local request.jwt.claim.sub to '61616161-6161-4161-8161-616161616101';
set local role authenticated;

create function pg_temp.text_row(p_id text, p_hlc text, p_body text, p_extra jsonb default '{}')
returns jsonb language sql as $$
  select jsonb_build_object(
    'id', p_id, 'kind', 'paste', 'title', 'Long', 'body', p_body,
    'source_url', null, 'graded_id', null, 'progress_offset', 0, 'read_ms', 0, 'finished_at', null,
    'feedback', null, 'created_at', 1761000000000, 'updated_at', 1761000000000, 'deleted_at', null,
    'hlc', p_hlc) || p_extra
$$;
create function pg_temp.push(p_table text, p_payload jsonb, p_op text default 'upsert')
returns jsonb language sql as $$
  select public.sync_push(jsonb_build_array(jsonb_build_object('table', p_table, 'op', p_op, 'payload', p_payload)))
$$;

-- ---------------------------------------------------------------- byte-bounded pages
-- Three texts of ~400 KB each: a 1 MB page holds two of them.
select is(jsonb_array_length(public.sync_push(jsonb_build_array(
  jsonb_build_object('table', 'user_texts', 'op', 'upsert', 'payload',
    pg_temp.text_row('0193a000-0000-7000-8000-000000006101', '001761000000000:00001:d', repeat('a', 400000))),
  jsonb_build_object('table', 'user_texts', 'op', 'upsert', 'payload',
    pg_temp.text_row('0193a000-0000-7000-8000-000000006102', '001761000000000:00002:d', repeat('b', 400000))),
  jsonb_build_object('table', 'user_texts', 'op', 'upsert', 'payload',
    pg_temp.text_row('0193a000-0000-7000-8000-000000006103', '001761000000000:00003:d', repeat('c', 400000)))
)) -> 'acked'), 3, 'three long texts pushed');

create temporary table p1 as select public.sync_pull_v4(0, 500, 0, 1048576) as r;
select is(jsonb_array_length((select r from p1) -> 'rows'), 2, 'a 1 MB page stops after two long texts');
select is(((select r from p1) ->> 'has_more')::boolean, true, 'and says there is more');
select is(jsonb_array_length(public.sync_pull_v4(((select r from p1) ->> 'next_seq')::bigint, 500, 0, 1048576) -> 'rows'),
  1, 'the next page brings the third');
select is(jsonb_array_length(public.sync_pull_v4(0, 500, 0, 1) -> 'rows'), 1,
  'a page always holds at least one row (the cursor moves even past a huge row)');
select is(jsonb_array_length(public.sync_pull_v4(0, 1, 0, 8388608) -> 'rows'), 1, 'the row limit still applies');
select ok(not ((public.sync_pull_v4(0, 500, 0) -> 'rows' -> 0 -> 'row') ? 'body_seq'), 'server columns are not sent');
select is(
  (select string_agg(r ->> 'seq', ',') from jsonb_array_elements(public.sync_pull_v4(0, 500, 0, 8388608) -> 'rows') r),
  (select string_agg(r ->> 'seq', ',') from jsonb_array_elements(public.sync_pull_v3(0, 500, 0) -> 'rows') r),
  'with room, v4 returns what v3 returns, in the same order');

-- ---------------------------------------------------------------- progress without the body
create temporary table cur as select ((select r from p1) ->> 'next_seq')::bigint as s,
  (public.sync_pull_v4(0, 500, 0, 8388608) ->> 'next_seq')::bigint as last;
select is(pg_temp.push('user_texts',
    pg_temp.text_row('0193a000-0000-7000-8000-000000006101', '001761000000000:00009:d', 'x',
      '{"progress_offset": 120, "read_ms": 5000, "updated_at": 1761000001000}') - 'body') -> 'acked',
  '["0193a000-0000-7000-8000-000000006101"]'::jsonb, 'a progress change without the body is accepted');
reset role;
select is((select length(body) from public.user_texts where id = '0193a000-0000-7000-8000-000000006101'), 400000,
  'the server keeps the body');
select is((select progress_offset from public.user_texts where id = '0193a000-0000-7000-8000-000000006101'), 120,
  'and stores the progress');
set local role authenticated;
create temporary table p2 as select public.sync_pull_v4((select last from cur), 500, (select last from cur)) as r;
select is((select r -> 'rows' -> 0 -> 'row' ->> 'progress_offset' from p2), '120', 'the change is pulled');
select ok(not ((select r -> 'rows' -> 0 -> 'row' from p2) ? 'body'), 'without the unchanged body');
select is((select (r -> 'rows' -> 0 -> 'row' ->> 'body_bytes')::int from p2), 400000, 'but with its length');
select ok((public.sync_pull_v4((select last from cur), 500, 0) -> 'rows' -> 0 -> 'row') ? 'body',
  'a full pull (p_from = 0) always sends the body');
select is(pg_temp.push('user_texts',
    pg_temp.text_row('0193a000-0000-7000-8000-000000006199', '001761000000000:00009:d', 'x') - 'body') -> 'rejected' -> 0 ->> 'code',
  '23502', 'a text the server does not have needs its body');
select is(pg_temp.push('user_texts',
    pg_temp.text_row('0193a000-0000-7000-8000-000000006102', '001761000000000:00000:d', 'x') - 'body') -> 'stale',
  '["0193a000-0000-7000-8000-000000006102"]'::jsonb, 'an older body-less change is stale');

-- ---------------------------------------------------------------- HLC from the future
select is(pg_temp.push('user_texts',
    pg_temp.text_row('0193a000-0000-7000-8000-000000006104', lpad(((extract(epoch from now()) * 1000)::bigint + 3 * 86400000)::text, 15, '0') || ':00000:d', 'x'))
    -> 'rejected' -> 0 ->> 'code',
  '22023', 'a row stamped days ahead is rejected');

-- ---------------------------------------------------------------- quotas
reset role;
update public.sync_limits set value = 4 where name = 'texts_per_user';
set local role authenticated;
select is(pg_temp.push('user_texts',
    pg_temp.text_row('0193a000-0000-7000-8000-000000006105', '001761000000000:00001:d', 'fourth')) -> 'acked',
  '["0193a000-0000-7000-8000-000000006105"]'::jsonb, 'a text within the quota');
select is(pg_temp.push('user_texts',
    pg_temp.text_row('0193a000-0000-7000-8000-000000006106', '001761000000000:00001:d', 'fifth')) -> 'rejected' -> 0 ->> 'code',
  '53400', 'a text over the quota is rejected');

reset role;
update public.sync_limits set value = (select calls from public.sync_usage
  where user_id = '61616161-6161-4161-8161-616161616101') where name = 'push_calls_per_day';
set local role authenticated;
select throws_ok($$ select pg_temp.push('notes', '{}'::jsonb) $$, '53400', null,
  'past the daily push limit, the whole call is refused');
select throws_ok($$ select * from public.sync_usage $$, '42501', null,
  'clients cannot read the usage counters');

select * from finish();
rollback;
