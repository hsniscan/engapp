-- The system jobs' pool of the monthly text budget (20261106000700_text_budget_pools.sql,
-- decision 0077): reserve inside the pool and the month, refusal at either cap with nothing
-- left reserved, settle moves the pool from reserved to spent, maintain reconciles, and
-- clients are locked out.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

set local role service_role;

create temporary table ph as select
  public.text_budget_reserve_pool(0.4, 10, 'levels', 'system', 1) as a,
  public.text_budget_reserve_pool(0.4, 10, 'levels', 'system', 1) as b;
grant select on ph to public;
select ok((select a from ph) is not null and (select b from ph) is not null, 'two holds inside the pool');
select is(public.text_budget_reserve_pool(0.4, 10, 'levels', 'system', 1), null,
  'a third would pass the pool');
select is((public.text_budget_pool_status('system') ->> 'reserved_usd')::numeric, 0.8::numeric,
  'the refused reservation left nothing reserved in the pool');
select is((public.text_budget_status() ->> 'reserved_usd')::numeric, 0.8::numeric, 'nor in the month');
select is((select pool from public.text_budget_holds where id = (select a from ph)), 'system',
  'the hold names its pool');
select ok(public.text_budget_reserve_pool(0.4, 10, 'morphemes', 'other_pool', 1) is not null,
  'another pool has its own cap');

select lives_ok($$ select public.text_budget_settle((select a from ph), 0.1) $$, 'settle with the real cost');
select is(public.text_budget_pool_status('system') - 'month',
  '{"spent_usd": 0.100000, "reserved_usd": 0.400000}'::jsonb, 'the pool moves from reserved to spent');

-- The month's cap still applies to the pool.
select is(public.text_budget_reserve_pool(0.5, 1.2, 'levels', 'system', 5), null, 'refused by the month''s cap');
select is((public.text_budget_pool_status('system') ->> 'reserved_usd')::numeric, 0.4::numeric,
  'and nothing stays reserved in the pool');
select ok(exists (select 1 from public.ops_events where kind = 'text_budget_pool_cap'),
  'a pool refusal is counted in ops_events');

-- A batch hold of a pool is not released as stale.
select ok(public.text_budget_reserve_pool(0.1, 10, 'levels', 'system', 5, true) is not null, 'batch hold in a pool');
select throws_ok($$ select public.text_budget_reserve_pool(0.1, 10, 'levels', 'Bad Pool', 5) $$,
  '22023', null, 'the pool is a tidy key');

-- Maintenance: a stale single-call hold is released, the pool's reserved is reconciled.
update public.text_budget_holds set created_at = now() - interval '1 hour' where id = (select b from ph);
update public.text_budget_pools set reserved_usd = reserved_usd + 3 where pool = 'system';
select is((public.text_budget_maintain() ->> 'released')::int, 1, 'a stale pool hold is released');
select is((public.text_budget_pool_status('system') ->> 'reserved_usd')::numeric,
  (select coalesce(sum(amount_usd), 0) from public.text_budget_holds where pool = 'system'),
  'the pool''s reserved is reconciled with its open holds');

reset role;
set local request.jwt.claims to '{"sub":"77777777-7777-4777-8777-777777777701","role":"authenticated"}';
set local role authenticated;
select throws_ok($$ select * from public.text_budget_pools $$, '42501', null, 'clients cannot read the pools');

select * from finish();
rollback;
