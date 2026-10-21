-- practice_logs and the sync table registry (20261021000900_practice.sql):
-- insert-only through sync_push, pulled only by sync_pull_v3 (v1/v2 keep the six v0.1
-- tables), isolated per user, and every registered table carries the standard RLS.
begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

-- ---------------------------------------------------------------- registry and RLS

select has_table('public', 'practice_logs', 'practice_logs exists');
select set_eq(
  $$ select name from public.sync_tables $$,
  array['notes', 'senses', 'cards', 'review_logs', 'sources', 'settings', 'practice_logs'],
  'the registry lists the six v0.1 tables and practice_logs');

select is_empty(
  $$ select st.name from public.sync_tables st join pg_class c on c.oid = format('public.%I', st.name)::regclass
      where not c.relrowsecurity $$,
  'every registered table has RLS enabled');

select is_empty(
  $$ select st.name from public.sync_tables st
      where (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = st.name
               and p.cmd in ('SELECT', 'INSERT') and 'authenticated' = any (p.roles)) < 2 $$,
  'every registered table has select and insert policies for authenticated');

select is_empty(
  $$ select st.name from public.sync_tables st
      where not st.insert_only
        and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = st.name and p.cmd = 'UPDATE') $$,
  'every mutable registered table has an update policy');

select is_empty(
  $$ select st.name from public.sync_tables st
      where st.insert_only
        and (exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = st.name and p.cmd in ('UPDATE', 'DELETE', 'ALL'))
             or has_table_privilege('authenticated', format('public.%I', st.name), 'UPDATE')
             or has_table_privilege('authenticated', format('public.%I', st.name), 'DELETE')) $$,
  'insert-only tables have no update/delete policy or privilege');

select is_empty(
  $$ select st.name from public.sync_tables st
      where not exists (select 1 from pg_trigger t where t.tgrelid = format('public.%I', st.name)::regclass
                          and t.tgname = 'stamp_sync_row') $$,
  'every registered table is stamped with server_seq');

select ok(not has_table_privilege('authenticated', 'public.sync_tables', 'INSERT')
          and not has_table_privilege('authenticated', 'public.sync_tables', 'UPDATE'),
  'clients cannot change the registry');

-- ---------------------------------------------------------------- push

insert into auth.users (id, email, aud, role) values
  ('55555555-5555-4555-8555-555555555555', 'e@test.local', 'authenticated', 'authenticated'),
  ('66666666-6666-4666-8666-666666666666', 'f@test.local', 'authenticated', 'authenticated');

set local request.jwt.claims to '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
set local request.jwt.claim.sub to '55555555-5555-4555-8555-555555555555';
set local role authenticated;

create function pg_temp.plog(p_id uuid, p_result text, p_hlc text)
returns jsonb language sql as $$
  select jsonb_build_object(
    'id', p_id, 'user_id', '66666666-6666-4666-8666-666666666666',
    'card_id', 'eeeeeeee-0000-7000-8000-0000000000c1', 'practiced_at', 1761000000000,
    'result', p_result, 'mode', 'hard', 'session_id', 'eeeeeeee-0000-7000-8000-0000000000aa',
    'duration_ms', 2400, 'device_id', 'deve', 'created_at', 1761000000000, 'hlc', p_hlc)
$$;

create temporary table r1 as select public.sync_push(jsonb_build_array(
  jsonb_build_object('table', 'practice_logs', 'op', 'upsert', 'payload',
    pg_temp.plog('eeeeeeee-0000-7000-8000-000000000001', 'unknown', '001761000000000:00001:deve')),
  jsonb_build_object('table', 'notes', 'op', 'upsert', 'payload', jsonb_build_object(
    'id', 'eeeeeeee-0000-7000-8000-0000000000b1', 'term', 'cope', 'term_norm', 'cope', 'term_type', 'word',
    'tags', '[]'::jsonb, 'possible_duplicate', false, 'created_at', 1, 'updated_at', 1, 'deleted_at', null,
    'hlc', '001761000000000:00002:deve'))
)) as res;
select is((select res -> 'acked' from r1),
  '["eeeeeeee-0000-7000-8000-000000000001", "eeeeeeee-0000-7000-8000-0000000000b1"]'::jsonb,
  'a practice log and a note are pushed in one batch');
select is((select user_id from public.practice_logs where id = 'eeeeeeee-0000-7000-8000-000000000001'),
  '55555555-5555-4555-8555-555555555555'::uuid, 'user_id comes from the session, not the payload');

-- The same id again, even with other content: acked, nothing changes (insert-only).
select is((public.sync_push(jsonb_build_array(jsonb_build_object('table', 'practice_logs', 'op', 'upsert', 'payload',
  pg_temp.plog('eeeeeeee-0000-7000-8000-000000000001', 'known', '001761000000000:00009:deve')))) -> 'acked'),
  '["eeeeeeee-0000-7000-8000-000000000001"]'::jsonb, 'a repeated practice log is acked');
select is((select result from public.practice_logs where id = 'eeeeeeee-0000-7000-8000-000000000001'), 'unknown',
  'and the stored row is unchanged');

select is((public.sync_push(jsonb_build_array(jsonb_build_object('table', 'practice_logs', 'op', 'delete', 'payload',
  pg_temp.plog('eeeeeeee-0000-7000-8000-000000000001', 'unknown', '001761000000000:00010:deve')))) -> 'rejected' -> 0 ->> 'code'),
  '42501', 'deleting a practice log is rejected');
select is((select count(*)::int from public.practice_logs), 1, 'and the row stays');

select is((select jsonb_array_length(public.sync_push(jsonb_build_array(jsonb_build_object('table', 'practice_logs', 'op', 'upsert', 'payload',
  pg_temp.plog('eeeeeeee-0000-7000-8000-000000000002', 'maybe', '001761000000000:00011:deve')))) -> 'rejected')),
  1, 'a practice log with an unknown result is rejected');

select throws_ok(
  $$ update public.practice_logs set result = 'known' $$,
  '42501', null, 'a client cannot update practice logs directly');

select is((select jsonb_array_length(public.sync_push(jsonb_build_array(jsonb_build_object('table', 'sync_tables', 'op', 'upsert', 'payload',
  jsonb_build_object('id', 'x', 'hlc', '001761000000000:00012:deve')))) -> 'rejected')),
  1, 'sync_push refuses tables outside the registry');

-- ---------------------------------------------------------------- pull

select is(
  (select count(*)::int from jsonb_array_elements(public.sync_pull_v3(0, 500, 0) -> 'rows') r where r ->> 'table' = 'practice_logs'),
  1, 'sync_pull_v3 returns the practice log');
select is(
  (select r -> 'row' ->> 'result' from jsonb_array_elements(public.sync_pull_v3(0, 500, 0) -> 'rows') r where r ->> 'table' = 'practice_logs'),
  'unknown', 'with its columns');
select ok(
  not (select (r -> 'row') ? 'server_seq' from jsonb_array_elements(public.sync_pull_v3(0, 500, 0) -> 'rows') r limit 1),
  'server columns are stripped');
select is(
  (select count(*)::int from jsonb_array_elements(public.sync_pull_v2(0, 500, 0) -> 'rows') r where r ->> 'table' = 'practice_logs')
  + (select count(*)::int from jsonb_array_elements(public.sync_pull(0, 500) -> 'rows') r where r ->> 'table' = 'practice_logs'),
  0, 'sync_pull and sync_pull_v2 (v0.1 clients) never return practice logs');
select set_eq(
  $$ select r ->> 'table' as tbl, r ->> 'seq' as seq from jsonb_array_elements(public.sync_pull_v3(0, 500, 0) -> 'rows') r where r ->> 'table' <> 'practice_logs' $$,
  $$ select r ->> 'table' as tbl, r ->> 'seq' as seq from jsonb_array_elements(public.sync_pull_v2(0, 500, 0) -> 'rows') r $$,
  'for the v0.1 tables sync_pull_v3 returns what sync_pull_v2 returns');

create temporary table p1 as select public.sync_pull_v3(0, 1, 0) as r;
select ok((select jsonb_array_length(r -> 'rows') = 1 and (r ->> 'has_more')::boolean from p1), 'v3 pages: one row, has_more');
select is(
  (select jsonb_array_length(public.sync_pull_v3((select (r ->> 'next_seq')::bigint from p1), 500, 0) -> 'rows')),
  1, 'the next page has the other row');

-- Tombstone horizon: same rule as sync_pull_v2 (decided by the cursor the pull started at).
reset role;
insert into public.sync_horizon (user_id, purged_through_seq)
values ('55555555-5555-4555-8555-555555555555', 9223372036854775000);
set local role authenticated;
select is((public.sync_pull_v3(5, 500, 5) ->> 'full_resync')::boolean, true,
  'an incremental v3 pull below the horizon answers full_resync');
select is((public.sync_pull_v3(5, 500, 0) ->> 'full_resync')::boolean, false,
  'a v3 pull that started at 0 pages normally');

-- ---------------------------------------------------------------- other user

set local request.jwt.claims to '{"sub":"66666666-6666-4666-8666-666666666666","role":"authenticated"}';
set local request.jwt.claim.sub to '66666666-6666-4666-8666-666666666666';
select is((select count(*)::int from public.practice_logs), 0, 'another user sees no practice logs');
select is((select jsonb_array_length(public.sync_pull_v3(0, 500, 0) -> 'rows')), 0, 'and pulls nothing');

select * from finish();
rollback;
