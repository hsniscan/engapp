-- Backend health (20261103000400_ops_health.sql, decision 0060): ops_health() reports the
-- budgets, refusals, jobs and database size, fails on a refused shared-budget call, and is
-- closed to clients.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

set local role service_role;
select ok((select count(*) from public.ops_health() where check_name in ('text_budget', 'image_budget', 'db_size')) = 3,
  'the budgets and the database size are checked');
select is((select status from public.ops_health() where check_name = 'text_budget_refusals'), 'ok',
  'no refusals: ok');
select public.ops_event('text_budget_global_cap', '{"purpose": "story"}');
select is((select status from public.ops_health() where check_name = 'text_budget_refusals'), 'fail',
  'a call refused by the shared budget fails the check');
select public.text_budget_reserve(9, 10, 'graded', true);
select is((select status from public.ops_health() where check_name = 'text_budget'), 'warn',
  '90 % of the text budget is a warning');
select public.job_heartbeat('db-backup', 'ok', '{}'::jsonb);
select is((select status from public.ops_health() where check_name = 'job_db-backup'), 'ok',
  'a fresh backup heartbeat is ok');

reset role;
set local role authenticated;
select throws_ok($$ select * from public.ops_health() $$, '42501', null, 'clients cannot read it');

select * from finish();
rollback;
