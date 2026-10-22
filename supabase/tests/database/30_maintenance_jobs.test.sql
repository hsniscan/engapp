-- İP10 maintenance (decision 0037). Job health (20261026001000_job_health.sql): heartbeats are
-- server-only; a good run moves last_ok_at, a failed one keeps it. Usage purge
-- (20261026001020_usage_purge.sql): read-aloud and picture counters go after 90 days.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

set local role service_role;
select lives_ok($$ select public.job_heartbeat('levels', 'ok', '{"senses": 3}'::jsonb) $$, 'service role writes a heartbeat');
select is((select runs from public.job_runs where job = 'levels'), 1, 'one run');
create temporary table ok0 as select last_ok_at from public.job_runs where job = 'levels';
grant select on ok0 to public;
select public.job_heartbeat('levels', 'failed', '{}'::jsonb);
select is((select last_ok_at from public.job_runs where job = 'levels'), (select last_ok_at from ok0),
  'a failed run keeps the last good time');
select is((select status from public.job_runs where job = 'levels'), 'failed', 'and shows the failure');
select is((select runs from public.job_runs where job = 'levels'), 2, 'runs are counted');
select is(jsonb_array_length(public.job_health()), 1, 'job_health lists the jobs');
select throws_ok($$ select public.job_heartbeat('Bad Name', 'ok', '{}'::jsonb) $$, '23514', null, 'job names are checked');

reset role;
insert into auth.users (id, email, aud, role) values
  ('33333333-3333-4333-8333-333333333331', 'purge@test.local', 'authenticated', 'authenticated');
insert into public.tts_usage (user_id, day) values
  ('33333333-3333-4333-8333-333333333331', current_date - 91), ('33333333-3333-4333-8333-333333333331', current_date);
insert into public.image_usage (user_id, day) values
  ('33333333-3333-4333-8333-333333333331', current_date - 120), ('33333333-3333-4333-8333-333333333331', current_date - 5);
set local role service_role;
select is(public.purge_usage_counters(90), '{"tts_usage": 1, "image_usage": 1}'::jsonb, 'old counters are purged');
select is((select count(*)::int from public.tts_usage where user_id = '33333333-3333-4333-8333-333333333331'), 1, 'today''s read-aloud counter stays');
select is((select count(*)::int from public.image_usage where user_id = '33333333-3333-4333-8333-333333333331'), 1, 'a recent picture counter stays');

reset role;
set local request.jwt.claims to '{"sub":"33333333-3333-4333-8333-333333333331","role":"authenticated"}';
set local role authenticated;
select throws_ok($$ select public.job_health() $$, '42501', null, 'clients cannot read job health');
select throws_ok($$ select * from public.job_runs $$, '42501', null, 'or the table');
select throws_ok($$ select public.purge_usage_counters(1) $$, '42501', null, 'clients cannot purge');

select * from finish();
rollback;
