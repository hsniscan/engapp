-- Smart new-card order (20261026001200_new_card_order.sql): the setting syncs, an older
-- client's push keeps it, unknown values are rejected.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

select has_column('public', 'settings', 'new_card_order', 'settings.new_card_order exists');
select col_type_is('public', 'settings', 'new_card_order', 'text', 'settings.new_card_order is text');

insert into auth.users (id, email, aud, role)
values ('39393939-3939-4939-8939-393939393939', 'o@test.local', 'authenticated', 'authenticated');
set local request.jwt.claims to '{"sub":"39393939-3939-4939-8939-393939393939","role":"authenticated"}';
set local request.jwt.claim.sub to '39393939-3939-4939-8939-393939393939';
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

-- An older app version creates the row without the key: null = smart.
select is(pg_temp.push(pg_temp.settings('001761000000000:00001:devo')) -> 'acked', '["settings"]'::jsonb,
  'a settings row without the column is pushed');

select pg_temp.push(pg_temp.settings('001761000000000:00002:devo') || '{"new_card_order": "added"}'::jsonb);
select is(
  (select r -> 'row' ->> 'new_card_order' from jsonb_array_elements(public.sync_pull_v3(0, 500, 0) -> 'rows') r
    where r ->> 'table' = 'settings'),
  'added', 'the order comes back on pull');

-- Another device on an older version changes the daily limit: the order is kept.
select pg_temp.push(pg_temp.settings('001761000000000:00003:devo') || '{"daily_new_limit": 20}'::jsonb);
select is((select new_card_order || ' ' || daily_new_limit from public.settings), 'added 20',
  'a push without the column keeps it');

select throws_ok(
  $$ update public.settings set new_card_order = 'random' $$,
  '23514', null, 'an unknown order is rejected');

select * from finish();
rollback;
