-- level_tests, known_terms and the settings level columns (20261022000500_level_test.sql):
-- level tests are insert-only, known words are tombstoned and purged, both are registered,
-- pulled only by sync_pull_v3 and isolated per user; an older client that pushes settings
-- without the level columns neither fails nor erases them.
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

-- ---------------------------------------------------------------- schema

select has_table('public', 'level_tests', 'level_tests exists');
select has_table('public', 'known_terms', 'known_terms exists');
select set_eq(
  $$ select name, insert_only from public.sync_tables where name in ('level_tests', 'known_terms') $$,
  $$ values ('level_tests', true), ('known_terms', false) $$,
  'both tables are registered; level_tests is insert-only');
select ok(not has_table_privilege('authenticated', 'public.known_terms', 'DELETE'),
  'known words cannot be hard-deleted by a client');
select has_column('public', 'settings', 'level_source', 'settings.level_source');
select has_column('public', 'settings', 'level_locked', 'settings.level_locked');

-- ---------------------------------------------------------------- push

insert into auth.users (id, email, aud, role) values
  ('77777777-7777-4777-8777-777777777777', 'g@test.local', 'authenticated', 'authenticated'),
  ('88888888-8888-4888-8888-888888888888', 'h@test.local', 'authenticated', 'authenticated');

set local request.jwt.claims to '{"sub":"77777777-7777-4777-8777-777777777777","role":"authenticated"}';
set local request.jwt.claim.sub to '77777777-7777-4777-8777-777777777777';
set local role authenticated;

create function pg_temp.ltest(p_id uuid, p_level text, p_hlc text)
returns jsonb language sql as $$
  select jsonb_build_object(
    'id', p_id, 'user_id', '88888888-8888-4888-8888-888888888888',
    'taken_at', 1761000000000, 'result_level', p_level, 'vocab_estimate', 4210, 'reliable', true,
    'false_alarm_rate', 0, 'ratios', '{"A1":1,"A2":0.95,"B1":0.85,"B2":0.6,"C1":0.2,"C2":0.05}'::jsonb,
    'items', '[{"w":"cope","band":"B1","pseudo":false,"answer":"yes"}]'::jsonb,
    'bank_version', 'bank-2026-10-1', 'applied', true, 'duration_ms', 240000,
    'device_id', 'devg', 'created_at', 1761000000000, 'hlc', p_hlc)
$$;

create function pg_temp.kterm(p_id uuid, p_term text, p_deleted bigint, p_hlc text)
returns jsonb language sql as $$
  select jsonb_build_object(
    'id', p_id, 'user_id', '88888888-8888-4888-8888-888888888888', 'term_norm', p_term,
    'source', 'test', 'cefr_at_mark', 'B1', 'created_at', 1761000000000, 'updated_at', 1761000000000,
    'deleted_at', p_deleted, 'hlc', p_hlc)
$$;

select is((public.sync_push(jsonb_build_array(
  jsonb_build_object('table', 'level_tests', 'op', 'upsert', 'payload',
    pg_temp.ltest('ffffffff-0000-7000-8000-000000000001', 'B1', '001761000000000:00001:devg')),
  jsonb_build_object('table', 'known_terms', 'op', 'upsert', 'payload',
    pg_temp.kterm('ffffffff-0000-7000-8000-0000000000a1', 'cope', null, '001761000000000:00002:devg'))
)) -> 'acked'),
  '["ffffffff-0000-7000-8000-000000000001", "ffffffff-0000-7000-8000-0000000000a1"]'::jsonb,
  'a level test and a known word are pushed in one batch');
select is((select user_id from public.level_tests where id = 'ffffffff-0000-7000-8000-000000000001'),
  '77777777-7777-4777-8777-777777777777'::uuid, 'user_id comes from the session, not the payload');

select is((public.sync_push(jsonb_build_array(jsonb_build_object('table', 'level_tests', 'op', 'upsert', 'payload',
  pg_temp.ltest('ffffffff-0000-7000-8000-000000000001', 'C2', '001761000000000:00009:devg')))) -> 'acked'),
  '["ffffffff-0000-7000-8000-000000000001"]'::jsonb, 'a repeated level test is acked');
select is((select result_level from public.level_tests where id = 'ffffffff-0000-7000-8000-000000000001'), 'B1',
  'and the stored test is unchanged');
select is((public.sync_push(jsonb_build_array(jsonb_build_object('table', 'level_tests', 'op', 'delete', 'payload',
  pg_temp.ltest('ffffffff-0000-7000-8000-000000000001', 'B1', '001761000000000:00010:devg')))) -> 'rejected' -> 0 ->> 'code'),
  '42501', 'deleting a level test is rejected');
select throws_ok(
  $$ update public.level_tests set result_level = 'C2' $$,
  '42501', null, 'a client cannot update level tests directly');

-- Removing a known word is a tombstone (LWW like the other mutable tables).
select is((public.sync_push(jsonb_build_array(jsonb_build_object('table', 'known_terms', 'op', 'delete', 'payload',
  pg_temp.kterm('ffffffff-0000-7000-8000-0000000000a1', 'cope', 1761000000500, '001761000000500:00000:devg')))) -> 'acked'),
  '["ffffffff-0000-7000-8000-0000000000a1"]'::jsonb, 'a removed known word is acked');
select is((select deleted_at from public.known_terms where id = 'ffffffff-0000-7000-8000-0000000000a1'), 1761000000500::bigint,
  'and stored as a tombstone');
select is((select jsonb_array_length(public.sync_push(jsonb_build_array(jsonb_build_object('table', 'known_terms', 'op', 'upsert', 'payload',
  pg_temp.kterm('ffffffff-0000-7000-8000-0000000000a2', 'cope', null, '001761000000000:00003:devg') || '{"source":"guess"}'::jsonb))) -> 'rejected')),
  1, 'a known word with an unknown source is rejected');

-- ---------------------------------------------------------------- settings from an older client

select is((select jsonb_array_length(public.sync_push(jsonb_build_array(jsonb_build_object('table', 'settings', 'op', 'upsert',
  'payload', '{"id":"settings","daily_new_limit":10,"request_retention":0.9,"timezone":"Europe/Istanbul","day_start_hour":4,"theme":"system","voice":"en-US","level":"B1","fsrs_params":null,"last_backup_at":null,"created_at":1,"updated_at":1,"deleted_at":null,"hlc":"001761000000000:00000:devg"}'::jsonb))) -> 'acked')),
  1, 'a settings row without the level columns (v0.1 client) is accepted');
select is((select level_source || '/' || level_locked::text from public.settings where id = 'settings'), 'default/false',
  'and gets the defaults');
select is((select jsonb_array_length(public.sync_push(jsonb_build_array(jsonb_build_object('table', 'settings', 'op', 'upsert',
  'payload', '{"id":"settings","daily_new_limit":10,"request_retention":0.9,"timezone":"Europe/Istanbul","day_start_hour":4,"theme":"system","voice":"en-US","fsrs_params":null,"last_backup_at":null,"level":"B2","level_source":"test","level_updated_at":1761000000100,"level_locked":true,"level_change":null,"created_at":1,"updated_at":2,"deleted_at":null,"hlc":"001761000000100:00000:devg"}'::jsonb))) -> 'acked')),
  1, 'a v0.2 client stores the level fields');
select is((select jsonb_array_length(public.sync_push(jsonb_build_array(jsonb_build_object('table', 'settings', 'op', 'upsert',
  'payload', '{"id":"settings","daily_new_limit":15,"request_retention":0.9,"timezone":"Europe/Istanbul","day_start_hour":4,"theme":"dark","voice":"en-US","level":"B2","fsrs_params":null,"last_backup_at":null,"created_at":1,"updated_at":3,"deleted_at":null,"hlc":"001761000000200:00000:devg"}'::jsonb))) -> 'acked')),
  1, 'a later v0.1 update is accepted');
select is((select level_source || '/' || level_locked::text || '/' || daily_new_limit from public.settings where id = 'settings'),
  'test/true/15', 'and keeps the level fields it does not know');

-- ---------------------------------------------------------------- pull

select is(
  (select count(*)::int from jsonb_array_elements(public.sync_pull_v3(0, 500, 0) -> 'rows') r
    where r ->> 'table' in ('level_tests', 'known_terms')),
  2, 'sync_pull_v3 returns the level test and the known word');
select is(
  (select count(*)::int from jsonb_array_elements(public.sync_pull_v2(0, 500, 0) -> 'rows') r where r ->> 'table' in ('level_tests', 'known_terms'))
  + (select count(*)::int from jsonb_array_elements(public.sync_pull(0, 500) -> 'rows') r where r ->> 'table' in ('level_tests', 'known_terms')),
  0, 'sync_pull and sync_pull_v2 (v0.1 clients) never return them');

-- ---------------------------------------------------------------- other user

set local request.jwt.claims to '{"sub":"88888888-8888-4888-8888-888888888888","role":"authenticated"}';
set local request.jwt.claim.sub to '88888888-8888-4888-8888-888888888888';
select is((select count(*)::int from public.level_tests) + (select count(*)::int from public.known_terms), 0,
  'another user sees no level tests or known words');

-- ---------------------------------------------------------------- purge

reset role;
alter table public.known_terms disable trigger stamp_sync_row;
update public.known_terms set server_updated_at = now() - interval '31 days';
alter table public.known_terms enable trigger stamp_sync_row;
alter table public.level_tests disable trigger stamp_sync_row;
update public.level_tests set server_updated_at = now() - interval '31 days';
alter table public.level_tests enable trigger stamp_sync_row;
create temporary table purged as select public.purge_tombstones(30) as r;
select is((select (r ->> 'known_terms')::int from purged), 1, 'purge removes the old known-word tombstone');
select is((select count(*)::int from public.level_tests), 1, 'and never touches level tests');

select * from finish();
rollback;
