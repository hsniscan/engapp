-- Text-AI budget (20261101000500_text_budget.sql, decision 0047): reserve before, settle with
-- the real cost after, refuse over the cap, batch holds survive the stale release, clients
-- can neither read nor use it.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

-- ---------------------------------------------------------------- service role
set local role service_role;

create temporary table h as
select public.text_budget_reserve(4, 10, 'graded', true) as a,
       public.text_budget_reserve(5, 10, 'gradedcheck') as b;
grant select on h to public;
select ok((select a from h) is not null and (select b from h) is not null, 'two holds within the cap');
select is((public.text_budget_status() ->> 'reserved_usd')::numeric, 9::numeric, 'both are reserved');
select is((public.text_budget_status() ->> 'cap_usd')::numeric, 10::numeric, 'the cap is stored');
select is(public.text_budget_reserve(1.000001, 10, 'story'), null, 'a reservation over the cap is refused');
select is(public.text_budget_reserve(11, 10, 'story'), null, 'one larger than the cap is refused');
select ok(public.text_budget_reserve(1, 10, 'story') is not null, 'exactly up to the cap is allowed');
select is(public.text_budget_reserve(0.000001, 10, 'story'), null, 'and then nothing more');
select is((select purpose from public.text_budget_holds where id = (select a from h)), 'graded', 'the hold keeps its purpose');
select is((select batch from public.text_budget_holds where id = (select a from h)), true, 'and whether it is a batch');

select lives_ok($$ select public.text_budget_settle((select b from h), 0.25) $$, 'settle with the real cost');
select is((public.text_budget_status() ->> 'spent_usd')::numeric, 0.25::numeric, 'spent is the real cost');
select is((public.text_budget_status() ->> 'reserved_usd')::numeric, 5::numeric, 'the hold left reserved');
select lives_ok($$ select public.text_budget_settle((select b from h), 0.25) $$, 'a second settle of the same hold');
select is((public.text_budget_status() ->> 'reserved_usd')::numeric, 5::numeric, 'does not free money twice');

update public.text_budget_holds set created_at = now() - interval '2 days';
select is(public.text_budget_release_stale('1 hour'), 1, 'only the single-call hold is released as stale');
select ok(exists (select 1 from public.text_budget_holds where id = (select a from h)), 'the batch hold stays for collect');

select throws_ok($$ select public.text_budget_reserve(0, 10, 'graded') $$, '22023', null, 'a zero amount is invalid');
select throws_ok($$ select public.text_budget_reserve(1, 10, 'Bad Purpose') $$, '23514', null, 'the purpose is a tidy key');

-- ---------------------------------------------------------------- clients
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "47474747-4747-4474-8474-474747474747", "role": "authenticated"}';
select throws_ok($$ select * from public.text_budget $$, '42501', null, 'clients cannot read the budget');
set local role anon;
select throws_ok($$ select public.text_budget_reserve(1, 1000, 'story') $$, '42501', null, 'nor reserve from it');

select * from finish();
rollback;
