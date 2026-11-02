-- AI cost guard rails (20261103000100_ai_fair_share.sql, decision 0060): per-feature daily
-- counters, the per-user share of the monthly text budget, stale-hold release and reconcile,
-- ops events without user data, and clients locked out of all of it.
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

insert into auth.users (id, email, aud, role) values
  ('60606060-6060-4060-8060-606060606001', 'fa@test.local', 'authenticated', 'authenticated'),
  ('60606060-6060-4060-8060-606060606002', 'fb@test.local', 'authenticated', 'authenticated');

set local role service_role;

-- ---------------------------------------------------------------- per-feature daily limit
select is((public.ai_consume_feature('60606060-6060-4060-8060-606060606001', 'ai-report', 2, 10) ->> 'allowed')::boolean,
  true, 'feature call 1 allowed');
select is((public.ai_consume_feature('60606060-6060-4060-8060-606060606001', 'ai-report', 2, 10) ->> 'allowed')::boolean,
  true, 'feature call 2 allowed');
select is(public.ai_consume_feature('60606060-6060-4060-8060-606060606001', 'ai-report', 2, 10),
  '{"allowed": false, "used": 2, "limit": 2}'::jsonb, 'feature call 3 refused at the feature limit');
select is((public.ai_consume_feature('60606060-6060-4060-8060-606060606001', 'ai-extract', 5, 10) ->> 'allowed')::boolean,
  true, 'another feature still has room');
select is((select calls from public.ai_usage where user_id = '60606060-6060-4060-8060-606060606001'
             and day = (now() at time zone 'utc')::date), 3, 'allowed calls also count in the shared counter');
-- The shared counter refuses: the feature counter is given back.
select is((public.ai_consume_feature('60606060-6060-4060-8060-606060606001', 'ai-themes', 5, 3) ->> 'allowed')::boolean,
  false, 'refused by the shared daily limit');
select is((select coalesce(sum(calls), 0)::int from public.ai_feature_usage
             where user_id = '60606060-6060-4060-8060-606060606001' and feature = 'ai-themes'), 0,
  'a call refused by the shared limit does not use the feature counter');
select throws_ok($$ select public.ai_consume_feature('60606060-6060-4060-8060-606060606001', 'Bad Feature', 5, 10) $$,
  '23514', null, 'the feature is a tidy key');
select ok((select count(*) from public.ops_events where kind = 'ai_feature_limit') >= 1, 'a refusal is counted in ops_events');

-- ---------------------------------------------------------------- per-user share
create temporary table h as select
  public.text_budget_reserve_user(0.4, 10, 'story', '60606060-6060-4060-8060-606060606001', 1) as a,
  public.text_budget_reserve_user(0.4, 10, 'story', '60606060-6060-4060-8060-606060606001', 1) as b;
grant select on h to public;
select ok((select a from h) is not null and (select b from h) is not null, 'two holds inside the user''s share');
select is(public.text_budget_reserve_user(0.4, 10, 'story', '60606060-6060-4060-8060-606060606001', 1), null,
  'a third would pass the user''s share');
select ok(public.text_budget_reserve_user(0.4, 10, 'story', '60606060-6060-4060-8060-606060606002', 1) is not null,
  'another user still has a share');
select is((public.text_budget_user_status('60606060-6060-4060-8060-606060606001') ->> 'reserved_usd')::numeric, 0.8::numeric,
  'the refused reservation left nothing reserved for the user');
select is((public.text_budget_status() ->> 'reserved_usd')::numeric, 1.2::numeric, 'nor globally');
select is((select user_id from public.text_budget_holds where id = (select a from h)),
  '60606060-6060-4060-8060-606060606001'::uuid, 'the hold names who pays');

select lives_ok($$ select public.text_budget_settle((select a from h), 0.1) $$, 'settle with the real cost');
select is(public.text_budget_user_status('60606060-6060-4060-8060-606060606001') - 'month',
  '{"spent_usd": 0.100000, "reserved_usd": 0.400000}'::jsonb, 'the user''s share moves from reserved to spent');

-- The global cap still applies.
select is(public.text_budget_reserve_user(0.9, 1.25, 'ai-fallback', '60606060-6060-4060-8060-606060606002', 5), null,
  'refused by the global cap');
select is((public.text_budget_user_status('60606060-6060-4060-8060-606060606002') ->> 'reserved_usd')::numeric, 0.4::numeric,
  'and nothing stays reserved for the user');

-- ---------------------------------------------------------------- maintenance
update public.text_budget_holds set created_at = now() - interval '1 hour' where id = (select b from h);
select is((public.text_budget_maintain() ->> 'released')::int, 1, 'a stale single-call hold is released');
update public.text_budget set reserved_usd = reserved_usd + 3;
select lives_ok($$ select public.text_budget_maintain() $$, 'maintain runs again');
select is((public.text_budget_status() ->> 'reserved_usd')::numeric,
  (select coalesce(sum(amount_usd), 0) from public.text_budget_holds
    where month = date_trunc('month', now() at time zone 'utc')::date),
  'reserved is reconciled with the open holds');

-- ---------------------------------------------------------------- clients
reset role;
set local request.jwt.claims to '{"sub":"60606060-6060-4060-8060-606060606001","role":"authenticated"}';
set local role authenticated;
select throws_ok($$ select public.ai_consume_feature('60606060-6060-4060-8060-606060606001', 'ai-report', 100, 100) $$,
  '42501', null, 'clients cannot use the counters');
select throws_ok($$ select * from public.text_budget_users $$, '42501', null, 'nor read anyone''s spend');

select * from finish();
rollback;
