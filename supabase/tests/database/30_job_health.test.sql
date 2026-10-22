-- Job health (20261026001000_job_health.sql): heartbeats are server-only; a good run moves
-- last_ok_at, a failed one keeps it.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

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
set local request.jwt.claims to '{"sub":"33333333-3333-4333-8333-333333333331","role":"authenticated"}';
set local role authenticated;
select throws_ok($$ select public.job_health() $$, '42501', null, 'clients cannot read job health');
select throws_ok($$ select * from public.job_runs $$, '42501', null, 'or the table');

select * from finish();
rollback;
