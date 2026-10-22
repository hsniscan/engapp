-- weekly_reports and settings.goals (20261023000900_weekly_reports.sql): reports are insert-only,
-- one per user and week (a second device's row for the same week is acked and skipped), pulled
-- only by sync_pull_v3, isolated per user and never purged; an older client that pushes settings
-- without goals keeps the stored goals.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

-- ---------------------------------------------------------------- schema

select has_table('public', 'weekly_reports', 'weekly_reports exists');
select is((select insert_only from public.sync_tables where name = 'weekly_reports'), true,
  'weekly_reports is registered as insert-only');
select ok((select relrowsecurity from pg_class where oid = 'public.weekly_reports'::regclass),
  'row level security is on');
select ok(not has_table_privilege('authenticated', 'public.weekly_reports', 'DELETE')
  and not has_table_privilege('authenticated', 'public.weekly_reports', 'UPDATE'),
  'a client can neither update nor delete reports');
select has_column('public', 'settings', 'goals', 'settings.goals');

-- ---------------------------------------------------------------- push

insert into auth.users (id, email, aud, role) values
  ('a7a7a7a7-7777-4777-8777-777777777777', 'r1@test.local', 'authenticated', 'authenticated'),
  ('b8b8b8b8-8888-4888-8888-888888888888', 'r2@test.local', 'authenticated', 'authenticated');

set local request.jwt.claims to '{"sub":"a7a7a7a7-7777-4777-8777-777777777777","role":"authenticated"}';
set local request.jwt.claim.sub to 'a7a7a7a7-7777-4777-8777-777777777777';
set local role authenticated;

create function pg_temp.report(p_id uuid, p_week text, p_comment text, p_hlc text)
returns jsonb language sql as $$
  select jsonb_build_object(
    'id', p_id, 'user_id', 'b8b8b8b8-8888-4888-8888-888888888888', 'week', p_week,
    'summary', '{"v":1,"active_days":5,"reviews":120,"focus":"keep_going"}'::jsonb,
    'comment', p_comment, 'comment_model', 'm', 'prompt_version', 'report-v1',
    'device_id', 'devr', 'created_at', 1761000000000, 'hlc', p_hlc)
$$;

create function pg_temp.push_report(p_id uuid, p_week text, p_comment text, p_hlc text, p_op text default 'upsert')
returns jsonb language sql as $$
  select public.sync_push(jsonb_build_array(jsonb_build_object(
    'table', 'weekly_reports', 'op', p_op, 'payload', pg_temp.report(p_id, p_week, p_comment, p_hlc))))
$$;

select is(pg_temp.push_report('eeeeeeee-0000-7000-8000-000000000001', '2026-10-12', 'İyi bir hafta.',
  '001761000000000:00001:devr') -> 'acked',
  '["eeeeeeee-0000-7000-8000-000000000001"]'::jsonb, 'a weekly report is pushed');
select is((select user_id from public.weekly_reports where id = 'eeeeeeee-0000-7000-8000-000000000001'),
  'a7a7a7a7-7777-4777-8777-777777777777'::uuid, 'user_id comes from the session, not the payload');

select is(pg_temp.push_report('eeeeeeee-0000-7000-8000-000000000001', '2026-10-12', 'Başka.',
  '001761000000000:00009:devr') -> 'acked',
  '["eeeeeeee-0000-7000-8000-000000000001"]'::jsonb, 'a repeated report is acked');
select is(pg_temp.push_report('eeeeeeee-0000-7000-8000-000000000002', '2026-10-12', 'İkinci cihaz.',
  '001761000000000:00002:devs') -> 'acked',
  '["eeeeeeee-0000-7000-8000-000000000002"]'::jsonb, 'another device''s report for the same week is acked');
select is((select count(*)::int from public.weekly_reports where week = '2026-10-12'), 1,
  'but skipped: one report per week');
select is((select comment from public.weekly_reports where week = '2026-10-12'), 'İyi bir hafta.',
  'and the first report is unchanged');
select is(pg_temp.push_report('eeeeeeee-0000-7000-8000-000000000003', '2026-10-19', null,
  '001761000000000:00003:devr') -> 'acked',
  '["eeeeeeee-0000-7000-8000-000000000003"]'::jsonb, 'a report without a comment is accepted');
select is(pg_temp.push_report('eeeeeeee-0000-7000-8000-000000000001', '2026-10-12', null,
  '001761000000000:00010:devr', 'delete') -> 'rejected' -> 0 ->> 'code',
  '42501', 'deleting a report is rejected');
select throws_ok(
  $$ update public.weekly_reports set comment = 'x' $$,
  '42501', null, 'a client cannot update reports directly');

-- ---------------------------------------------------------------- settings.goals

select is((select jsonb_array_length(public.sync_push(jsonb_build_array(jsonb_build_object('table', 'settings', 'op', 'upsert',
  'payload', '{"id":"settings","daily_new_limit":10,"request_retention":0.9,"timezone":"Europe/Istanbul","day_start_hour":4,"theme":"system","voice":"en-US","level":"B1","fsrs_params":null,"last_backup_at":null,"goals":{"week_active_days":5,"week_minutes":90},"created_at":1,"updated_at":1,"deleted_at":null,"hlc":"001761000000100:00000:devr"}'::jsonb))) -> 'acked')),
  1, 'settings with goals are stored');
select is((select jsonb_array_length(public.sync_push(jsonb_build_array(jsonb_build_object('table', 'settings', 'op', 'upsert',
  'payload', '{"id":"settings","daily_new_limit":12,"request_retention":0.9,"timezone":"Europe/Istanbul","day_start_hour":4,"theme":"dark","voice":"en-US","level":"B1","fsrs_params":null,"last_backup_at":null,"created_at":1,"updated_at":2,"deleted_at":null,"hlc":"001761000000200:00000:devr"}'::jsonb))) -> 'acked')),
  1, 'an older client pushes settings without goals');
select is((select goals ->> 'week_active_days' || '/' || daily_new_limit from public.settings where id = 'settings'),
  '5/12', 'and the stored goals are kept');

-- ---------------------------------------------------------------- pull

select is(
  (select count(*)::int from jsonb_array_elements(public.sync_pull_v3(0, 500, 0) -> 'rows') r
    where r ->> 'table' = 'weekly_reports'),
  2, 'sync_pull_v3 returns the reports');
select is(
  (select count(*)::int from jsonb_array_elements(public.sync_pull_v2(0, 500, 0) -> 'rows') r where r ->> 'table' = 'weekly_reports')
  + (select count(*)::int from jsonb_array_elements(public.sync_pull(0, 500) -> 'rows') r where r ->> 'table' = 'weekly_reports'),
  0, 'sync_pull and sync_pull_v2 (v0.1 clients) never return them');

-- ---------------------------------------------------------------- other user

set local request.jwt.claims to '{"sub":"b8b8b8b8-8888-4888-8888-888888888888","role":"authenticated"}';
set local request.jwt.claim.sub to 'b8b8b8b8-8888-4888-8888-888888888888';
select is((select count(*)::int from public.weekly_reports), 0, 'another user sees no reports');
select is(pg_temp.push_report('eeeeeeee-0000-7000-8000-0000000000b1', '2026-10-12', null,
  '001761000000000:00001:devb') -> 'acked',
  '["eeeeeeee-0000-7000-8000-0000000000b1"]'::jsonb, 'and has a week of its own');

-- ---------------------------------------------------------------- purge

reset role;
alter table public.weekly_reports disable trigger stamp_sync_row;
update public.weekly_reports set server_updated_at = now() - interval '400 days';
alter table public.weekly_reports enable trigger stamp_sync_row;
select public.purge_tombstones(30);
select is((select count(*)::int from public.weekly_reports), 3, 'purge never touches reports');

select * from finish();
rollback;
