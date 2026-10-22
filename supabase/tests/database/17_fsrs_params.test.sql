-- Personal FSRS parameters (20261023000400_fsrs_params.sql): settings.fsrs_params_prev and
-- settings.fsrs_opt_at sync, are bounded, and survive a push from an app version without them.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

select has_column('public', 'settings', 'fsrs_params_prev', 'settings.fsrs_params_prev exists');
select col_type_is('public', 'settings', 'fsrs_params_prev', 'double precision[]', 'it is a float array');
select has_column('public', 'settings', 'fsrs_opt_at', 'settings.fsrs_opt_at exists');
select col_type_is('public', 'settings', 'fsrs_opt_at', 'bigint', 'it is epoch ms');

insert into auth.users (id, email, aud, role)
values ('99999999-9999-4999-8999-999999999915', 'f@test.local', 'authenticated', 'authenticated');
set local request.jwt.claims to '{"sub":"99999999-9999-4999-8999-999999999915","role":"authenticated"}';
set local request.jwt.claim.sub to '99999999-9999-4999-8999-999999999915';
set local role authenticated;

create function pg_temp.settings(p_hlc text)
returns jsonb language sql as $$
  select jsonb_build_object(
    'id', 'settings', 'daily_new_limit', 10, 'request_retention', 0.9, 'timezone', 'Europe/Istanbul',
    'day_start_hour', 4, 'theme', 'system', 'voice', 'en-US', 'level', 'B1', 'fsrs_params', null,
    'last_backup_at', null, 'created_at', 1, 'updated_at', 1, 'deleted_at', null, 'hlc', p_hlc)
$$;

select is((public.sync_push(jsonb_build_array(jsonb_build_object('table', 'settings', 'op', 'upsert',
  'payload', pg_temp.settings('001761000000000:00001:devf')))) -> 'acked'),
  '["settings"]'::jsonb, 'a settings row without the columns is pushed');
select ok((select fsrs_params_prev is null and fsrs_opt_at is null from public.settings),
  'missing means nothing to revert, never ran');

select is((public.sync_push(jsonb_build_array(jsonb_build_object('table', 'settings', 'op', 'upsert',
  'payload', pg_temp.settings('001761000000000:00002:devf')
    || '{"fsrs_params": [0.2, 1.3, 2.3, 8.3, 6.4, 0.83, 3.0, 0.001, 1.87, 0.17, 0.8, 1.48, 0.06, 0.26, 1.65, 0.6, 1.87, 0.54, 0.09, 0.07, 0.3]}'::jsonb
    || '{"fsrs_params_prev": null, "fsrs_opt_at": 1761000000000}'::jsonb))) -> 'stale'),
  '[]'::jsonb, 'adopted params are pushed');
select is(
  (select (r -> 'row' ->> 'fsrs_opt_at')::bigint from jsonb_array_elements(public.sync_pull_v3(0, 500, 0) -> 'rows') r
    where r ->> 'table' = 'settings'),
  1761000000000::bigint, 'they come back on pull');

-- Another device on an older version changes the daily limit: the columns are kept.
select public.sync_push(jsonb_build_array(jsonb_build_object('table', 'settings', 'op', 'upsert',
  'payload', pg_temp.settings('001761000000000:00003:devf') || '{"daily_new_limit": 20}'::jsonb)));
select is((select fsrs_opt_at::text || ' ' || daily_new_limit from public.settings),
  '1761000000000 20', 'a push without the columns keeps them');

select throws_ok(
  $$update public.settings set fsrs_params_prev = array_fill(1::double precision, array[65])$$,
  '23514', null, 'fsrs_params_prev is bounded');

select * from finish();
rollback;
