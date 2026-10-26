-- "Hep tahmin ettir" (20261102000100_reader_always_guess.sql): the setting syncs and an older
-- client's push keeps it.
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

select has_column('public', 'settings', 'reader_always_guess', 'settings.reader_always_guess exists');
select col_type_is('public', 'settings', 'reader_always_guess', 'boolean', 'it is a boolean');

insert into auth.users (id, email, aud, role) values
  ('54545454-5454-4545-8545-545454545454', 'g1@test.local', 'authenticated', 'authenticated');

set local request.jwt.claims to '{"sub":"54545454-5454-4545-8545-545454545454","role":"authenticated"}';
set local request.jwt.claim.sub to '54545454-5454-4545-8545-545454545454';
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
select ok((select reader_always_guess is null from public.settings), 'missing means off');

select pg_temp.push(pg_temp.settings('001762000000000:00002:devg') || '{"reader_always_guess": true}'::jsonb);
select is(
  (select (r -> 'row' ->> 'reader_always_guess')::boolean from jsonb_array_elements(public.sync_pull_v3(0, 500, 0) -> 'rows') r
    where r ->> 'table' = 'settings'),
  true, 'the choice comes back on pull');

-- Another device on an older version changes the daily limit: the choice is kept.
select pg_temp.push(pg_temp.settings('001762000000000:00003:devg') || '{"daily_new_limit": 20}'::jsonb);
select is((select reader_always_guess from public.settings), true, 'a push without the column keeps it');

select * from finish();
rollback;
