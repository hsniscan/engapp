-- Study options (20261103001500_study_options.sql): the setting syncs, an older client's push
-- keeps it, and only a JSON object is stored.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

select has_column('public', 'settings', 'study_options', 'settings.study_options exists');
select col_type_is('public', 'settings', 'study_options', 'jsonb', 'it is jsonb');

insert into auth.users (id, email, aud, role) values
  ('62626262-6262-4626-8626-626262626262', 'g62@test.local', 'authenticated', 'authenticated');

set local request.jwt.claims to '{"sub":"62626262-6262-4626-8626-626262626262","role":"authenticated"}';
set local request.jwt.claim.sub to '62626262-6262-4626-8626-626262626262';
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

-- An older app version creates the row without the key: null = off.
select pg_temp.push(pg_temp.settings('001762000000000:00001:devg'));
select ok((select study_options is null from public.settings), 'missing means the defaults');

select pg_temp.push(pg_temp.settings('001762000000000:00002:devg') || '{"study_options": {"session_cards": 20, "mode_new_limits": {"cloze": 3}}}'::jsonb);
select is(
  (select (r -> 'row' -> 'study_options' ->> 'session_cards')::int from jsonb_array_elements(public.sync_pull_v3(0, 500, 0) -> 'rows') r
    where r ->> 'table' = 'settings'),
  20, 'the options come back on pull');

-- Another device on an older version changes the daily limit: the choice is kept.
select pg_temp.push(pg_temp.settings('001762000000000:00003:devg') || '{"daily_new_limit": 20}'::jsonb);
select is((select study_options -> 'mode_new_limits' ->> 'cloze' from public.settings), '3', 'a push without the column keeps it');

reset role;
select throws_ok(
  $$update public.settings set study_options = '[1]'::jsonb$$,
  '23514', null, 'only an object is stored');

select * from finish();
rollback;
