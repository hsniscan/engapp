-- Smart extraction (20261022000600_smart_extract.sql): settings.show_easy_candidates syncs,
-- defaults to false, and survives a push from an app version without the column. Nothing
-- about what the user knows is stored on the server by this package.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

select has_column('public', 'settings', 'show_easy_candidates', 'settings.show_easy_candidates exists');
select col_type_is('public', 'settings', 'show_easy_candidates', 'boolean', 'it is a boolean');
select col_default_is('public', 'settings', 'show_easy_candidates', 'false', 'it defaults to false');

insert into auth.users (id, email, aud, role)
values ('88888888-8888-4888-8888-888888888888', 'h@test.local', 'authenticated', 'authenticated');
set local request.jwt.claims to '{"sub":"88888888-8888-4888-8888-888888888888","role":"authenticated"}';
set local request.jwt.claim.sub to '88888888-8888-4888-8888-888888888888';
set local role authenticated;

create function pg_temp.settings(p_hlc text)
returns jsonb language sql as $$
  select jsonb_build_object(
    'id', 'settings', 'daily_new_limit', 10, 'request_retention', 0.9, 'timezone', 'Europe/Istanbul',
    'day_start_hour', 4, 'theme', 'system', 'voice', 'en-US', 'level', 'B1', 'fsrs_params', null,
    'last_backup_at', null, 'created_at', 1, 'updated_at', 1, 'deleted_at', null, 'hlc', p_hlc)
$$;

-- An older app version creates the row without the key: null, which the app reads as false.
select is((public.sync_push(jsonb_build_array(jsonb_build_object('table', 'settings', 'op', 'upsert',
  'payload', pg_temp.settings('001761000000000:00001:devh')))) -> 'acked'),
  '["settings"]'::jsonb, 'a settings row without the column is pushed');
select ok(coalesce((select show_easy_candidates from public.settings), false) = false,
  'missing means closed');

select is((public.sync_push(jsonb_build_array(jsonb_build_object('table', 'settings', 'op', 'upsert',
  'payload', pg_temp.settings('001761000000000:00002:devh') || '{"show_easy_candidates": true}'::jsonb))) -> 'stale'),
  '[]'::jsonb, 'the setting is pushed');
select is(
  (select (r -> 'row' ->> 'show_easy_candidates')::boolean from jsonb_array_elements(public.sync_pull_v3(0, 500, 0) -> 'rows') r
    where r ->> 'table' = 'settings'),
  true, 'it comes back on pull');

-- Another device on an older version changes the daily limit: the setting is kept.
select public.sync_push(jsonb_build_array(jsonb_build_object('table', 'settings', 'op', 'upsert',
  'payload', pg_temp.settings('001761000000000:00003:devh') || '{"daily_new_limit": 20}'::jsonb)));
select is((select show_easy_candidates::text || ' ' || daily_new_limit from public.settings),
  'true 20', 'a push without the column keeps it');

select * from finish();
rollback;
