-- Streak protections (20261101001000_streak_freezes.sql): the list syncs, an older client's push
-- keeps it, malformed lists are rejected, and another account never sees or changes it.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

select has_column('public', 'settings', 'streak_freezes', 'settings.streak_freezes exists');
select col_type_is('public', 'settings', 'streak_freezes', 'jsonb', 'settings.streak_freezes is jsonb');

insert into auth.users (id, email, aud, role) values
  ('52525252-5252-4525-8525-525252525252', 'f1@test.local', 'authenticated', 'authenticated'),
  ('53535353-5353-4535-8535-535353535353', 'f2@test.local', 'authenticated', 'authenticated');

set local request.jwt.claims to '{"sub":"52525252-5252-4525-8525-525252525252","role":"authenticated"}';
set local request.jwt.claim.sub to '52525252-5252-4525-8525-525252525252';
set local role authenticated;

create function pg_temp.settings(p_hlc text)
returns jsonb language sql as $$
  select jsonb_build_object(
    'id', 'settings', 'daily_new_limit', 10, 'request_retention', 0.9, 'timezone', 'Europe/Istanbul',
    'day_start_hour', 4, 'theme', 'system', 'voice', 'en-US', 'level', 'B1', 'fsrs_params', null,
    'last_backup_at', null, 'created_at', 1, 'updated_at', 1, 'deleted_at', null, 'hlc', p_hlc)
$$;
create function pg_temp.push(p jsonb)
returns jsonb language sql as $$
  select public.sync_push(jsonb_build_array(jsonb_build_object('table', 'settings', 'op', 'upsert', 'payload', p)))
$$;

-- An older app version creates the row without the key: null = none.
select is(pg_temp.push(pg_temp.settings('001762000000000:00001:devf')) -> 'acked', '["settings"]'::jsonb,
  'a settings row without the column is pushed');
select ok((select streak_freezes is null from public.settings), 'missing means none');

select pg_temp.push(pg_temp.settings('001762000000000:00002:devf') || '{"streak_freezes": ["2026-11-03", "2026-11-04"]}'::jsonb);
select is(
  (select r -> 'row' -> 'streak_freezes' from jsonb_array_elements(public.sync_pull_v3(0, 500, 0) -> 'rows') r
    where r ->> 'table' = 'settings'),
  '["2026-11-03", "2026-11-04"]'::jsonb, 'the covered days come back on pull');

-- Another device on an older version changes the daily limit: the protections are kept.
select pg_temp.push(pg_temp.settings('001762000000000:00003:devf') || '{"daily_new_limit": 20}'::jsonb);
select is((select (streak_freezes ->> 1) || ' ' || daily_new_limit from public.settings),
  '2026-11-04 20', 'a push without the column keeps it');

-- Malformed lists are rejected.
select throws_ok($$update public.settings set streak_freezes = '"2026-11-03"'$$,
  '23514', null, 'a single string is rejected');
select throws_ok($$update public.settings set streak_freezes = '["yesterday"]'$$,
  '23514', null, 'a day that is not a day key is rejected');
select throws_ok(
  $$update public.settings set streak_freezes = (select jsonb_agg(to_char(date '2026-01-01' + i, 'YYYY-MM-DD')) from generate_series(0, 48) i)$$,
  '23514', null, 'more than 48 days are rejected');

-- Another account: sees nothing of it and cannot change it.
set local request.jwt.claims to '{"sub":"53535353-5353-4535-8535-535353535353","role":"authenticated"}';
set local request.jwt.claim.sub to '53535353-5353-4535-8535-535353535353';
select is((select count(*)::int from public.settings), 0, 'another account sees no settings row');
select is(
  (select count(*)::int from jsonb_array_elements(public.sync_pull_v3(0, 500, 0) -> 'rows') r where r ->> 'table' = 'settings'),
  0, 'and pulls none');
update public.settings set streak_freezes = '["2026-11-05"]';
reset role;
select is((select streak_freezes::text from public.settings where user_id = '52525252-5252-4525-8525-525252525252'),
  '["2026-11-03", "2026-11-04"]', 'its update changed nothing');

select * from finish();
rollback;
