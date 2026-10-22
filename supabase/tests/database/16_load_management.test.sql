-- Load management (20261023000300_load_management.sql): the four settings sync, an older
-- client's push keeps them, a vacation clears with an explicit null, malformed ranges are
-- rejected, and on_vacation / settings_local_day answer for server jobs (push-send).
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

select has_column('public', 'settings', 'daily_capacity_min', 'settings.daily_capacity_min exists');
select has_column('public', 'settings', 'catchup_auto', 'settings.catchup_auto exists');
select col_type_is('public', 'settings', 'vacation', 'jsonb', 'settings.vacation is jsonb');
select col_type_is('public', 'settings', 'vacation_history', 'jsonb', 'settings.vacation_history is jsonb');

insert into auth.users (id, email, aud, role)
values ('91919191-9191-4919-8919-919191919191', 'v@test.local', 'authenticated', 'authenticated');
set local request.jwt.claims to '{"sub":"91919191-9191-4919-8919-919191919191","role":"authenticated"}';
set local request.jwt.claim.sub to '91919191-9191-4919-8919-919191919191';
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

-- An older app version creates the row without the keys: null = the defaults.
select is(pg_temp.push(pg_temp.settings('001761000000000:00001:devv')) -> 'acked', '["settings"]'::jsonb,
  'a settings row without the columns is pushed');
select ok((select daily_capacity_min is null and catchup_auto is null and vacation is null from public.settings),
  'missing means the defaults');

select is(pg_temp.push(pg_temp.settings('001761000000000:00002:devv') || '{"daily_capacity_min": 30, "catchup_auto": false,
  "vacation": {"start": "2026-11-01", "end": "2026-11-05"},
  "vacation_history": [{"start": "2026-08-01", "end": "2026-08-03"}]}'::jsonb) -> 'stale',
  '[]'::jsonb, 'the load settings are pushed');
select is(
  (select r -> 'row' -> 'vacation' from jsonb_array_elements(public.sync_pull_v3(0, 500, 0) -> 'rows') r
    where r ->> 'table' = 'settings'),
  '{"start": "2026-11-01", "end": "2026-11-05"}'::jsonb, 'the vacation comes back on pull');

-- Another device on an older version changes the daily limit: the load settings are kept.
select pg_temp.push(pg_temp.settings('001761000000000:00003:devv') || '{"daily_new_limit": 20}'::jsonb);
select is((select daily_capacity_min || ' ' || catchup_auto || ' ' || (vacation ->> 'end') || ' ' || daily_new_limit from public.settings),
  '30 false 2026-11-05 20', 'a push without the columns keeps them');

-- A newer client clears the vacation with an explicit null.
select pg_temp.push(pg_temp.settings('001761000000000:00004:devv') || '{"vacation": null}'::jsonb);
select ok((select vacation is null and vacation_history is not null from public.settings), 'null clears the vacation');

-- Malformed values are rejected (the row stays as it was).
select throws_ok(
  $$update public.settings set vacation = '{"start": "2026-11-05", "end": "2026-11-01"}'$$,
  '23514', null, 'a vacation that ends before it starts is rejected');
select throws_ok(
  $$update public.settings set vacation = '{"start": "soon"}'$$,
  '23514', null, 'a vacation without day keys is rejected');
select throws_ok(
  $$update public.settings set daily_capacity_min = 0$$,
  '23514', null, 'a capacity of 0 minutes is rejected');

-- Helpers for server jobs.
select ok(public.on_vacation('{"start": "2026-11-01", "end": "2026-11-05"}', '2026-11-05'), 'the last day is a vacation day');
select ok(not public.on_vacation('{"start": "2026-11-01", "end": "2026-11-05"}', '2026-11-06'), 'the day after is not');
select ok(not public.on_vacation(null, '2026-11-06'), 'no vacation: never on vacation');
select is(public.settings_local_day('Europe/Istanbul', 4, '2026-11-02 00:30:00+00'), '2026-11-01'::date,
  '03:30 in Istanbul still belongs to the day before');

select * from finish();
rollback;
